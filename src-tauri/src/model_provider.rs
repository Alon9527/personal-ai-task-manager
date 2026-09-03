use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    fs::{self, File, OpenOptions},
    future::Future,
    io::Write,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        atomic::Ordering,
        Arc, Mutex,
    },
    task::{Context, Poll, Waker},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use url::Url;
use uuid::Uuid;

const REGISTRY_VERSION: u8 = 1;
const MAX_PROFILES: usize = 20;
const MAX_PENDING_CREDENTIAL_DELETES: usize = 20;
const MAX_REGISTRY_BYTES: u64 = 128 * 1024;
const MAX_CREDENTIAL_GENERATION: u64 = 9_007_199_254_740_991;
const MAX_NAME_CHARS: usize = 40;
const MAX_BASE_URL_BYTES: usize = 2_048;
const MAX_MODEL_ID_CHARS: usize = 160;
const MAX_TIMESTAMP_BYTES: usize = 64;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model_id: String,
    #[serde(default)]
    pub credential_generation: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfileDto {
    id: String,
    name: String,
    base_url: String,
    model_id: String,
    credential_generation: u64,
    has_credential: bool,
    is_local: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderListDto {
    profiles: Vec<ProviderProfileDto>,
    pending_credential_deletes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateProviderInput {
    name: String,
    base_url: String,
    model_id: String,
    api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateProviderInput {
    name: String,
    base_url: String,
    model_id: String,
}

struct OwnedProviderSecret {
    value: Option<String>,
    #[cfg(test)]
    zeroize_observer: Option<Arc<dyn Fn(&[u8]) + Send + Sync>>,
}

impl OwnedProviderSecret {
    fn new(value: String) -> Self {
        Self {
            value: Some(value),
            #[cfg(test)]
            zeroize_observer: None,
        }
    }

    #[cfg(test)]
    fn with_observer(
        value: String,
        zeroize_observer: Arc<dyn Fn(&[u8]) + Send + Sync>,
    ) -> Self {
        Self {
            value: Some(value),
            zeroize_observer: Some(zeroize_observer),
        }
    }

    fn as_str(&self) -> &str {
        self.value.as_deref().expect("provider secret is available until save returns")
    }

    fn zeroize(&mut self) {
        let Some(value) = self.value.as_mut() else {
            return;
        };
        for byte in unsafe { value.as_mut_vec() } {
            unsafe { std::ptr::write_volatile(byte, 0) };
        }
        std::sync::atomic::compiler_fence(Ordering::SeqCst);
        #[cfg(test)]
        if let Some(observer) = &self.zeroize_observer {
            observer(value.as_bytes());
        }
        self.value = None;
    }
}

impl Drop for OwnedProviderSecret {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderRegistryV1 {
    version: u8,
    profiles: Vec<ProviderProfile>,
    pending_credential_deletes: Vec<String>,
}

impl Default for ProviderRegistryV1 {
    fn default() -> Self {
        Self {
            version: REGISTRY_VERSION,
            profiles: Vec::new(),
            pending_credential_deletes: Vec::new(),
        }
    }
}

trait RegistryPublisher: Send + Sync {
    fn publish(&self, temporary_path: &Path, registry_path: &Path) -> Result<(), String>;
}

pub trait ProviderCredentials: Send + Sync {
    fn exists(&self, profile_id: &str) -> Result<bool, String>;
    fn read(&self, profile_id: &str) -> Result<Option<String>, String>;
    fn save(&self, profile_id: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, profile_id: &str) -> Result<(), String>;
}

struct WindowsProviderCredentials;

impl ProviderCredentials for WindowsProviderCredentials {
    fn exists(&self, profile_id: &str) -> Result<bool, String> {
        crate::provider_credential_store::exists(profile_id)
    }

    fn read(&self, profile_id: &str) -> Result<Option<String>, String> {
        crate::provider_credential_store::read(profile_id)
    }

    fn save(&self, profile_id: &str, secret: &str) -> Result<(), String> {
        crate::provider_credential_store::save(profile_id, secret.to_string())
    }

    fn delete(&self, profile_id: &str) -> Result<(), String> {
        crate::provider_credential_store::delete(profile_id)
    }
}

struct NativeRegistryPublisher;

#[cfg(windows)]
impl RegistryPublisher for NativeRegistryPublisher {
    fn publish(&self, temporary_path: &Path, registry_path: &Path) -> Result<(), String> {
        use std::{os::windows::ffi::OsStrExt, ptr};
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH,
        };

        fn wide(path: &Path) -> Vec<u16> {
            path.as_os_str().encode_wide().chain(Some(0)).collect()
        }

        let temporary = wide(temporary_path);
        let destination = wide(registry_path);
        let succeeded = unsafe {
            if registry_path.exists() {
                ReplaceFileW(
                    destination.as_ptr(),
                    temporary.as_ptr(),
                    ptr::null(),
                    0,
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            } else {
                MoveFileExW(
                    temporary.as_ptr(),
                    destination.as_ptr(),
                    MOVEFILE_WRITE_THROUGH,
                )
            }
        };
        if succeeded == 0 {
            return Err(format!(
                "无法原子发布模型服务商设置：{}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
impl RegistryPublisher for NativeRegistryPublisher {
    fn publish(&self, temporary_path: &Path, registry_path: &Path) -> Result<(), String> {
        fs::rename(temporary_path, registry_path)
            .map_err(|error| format!("无法原子发布模型服务商设置：{error}"))
    }
}

pub struct ModelProviderStore {
    registry_path: PathBuf,
    recovery_path: PathBuf,
    publisher: Arc<dyn RegistryPublisher>,
    credentials: Arc<dyn ProviderCredentials>,
    connection_test_queue: Arc<ConnectionTestQueue>,
}

struct ConnectionTestPermit {
    queue: Arc<ConnectionTestQueue>,
}

impl Drop for ConnectionTestPermit {
    fn drop(&mut self) {
        self.queue.release();
    }
}

#[derive(Default)]
struct ConnectionTestQueue {
    state: Mutex<ConnectionTestQueueState>,
}

#[derive(Default)]
struct ConnectionTestQueueState {
    active: bool,
    next_waiter_id: u64,
    granted_waiter: Option<u64>,
    waiters: VecDeque<ConnectionTestWaiter>,
}

struct ConnectionTestWaiter {
    id: u64,
    waker: Waker,
}

struct ConnectionTestAcquire {
    queue: Arc<ConnectionTestQueue>,
    waiter_id: Option<u64>,
    acquired: bool,
}

impl ConnectionTestQueue {
    #[cfg(test)]
    fn try_acquire(self: &Arc<Self>) -> Result<ConnectionTestPermit, String> {
        let mut state = self.state.lock().map_err(|_| "测试连接状态异常".to_string())?;
        if state.active || !state.waiters.is_empty() || state.granted_waiter.is_some() {
            return Err("测试连接已在队列中，请等待当前测试完成".to_string());
        }
        state.active = true;
        Ok(ConnectionTestPermit { queue: self.clone() })
    }

    fn acquire(self: &Arc<Self>) -> ConnectionTestAcquire {
        ConnectionTestAcquire {
            queue: self.clone(),
            waiter_id: None,
            acquired: false,
        }
    }

    fn is_busy(&self) -> Result<bool, String> {
        let state = self.state.lock().map_err(|_| "测试连接状态异常".to_string())?;
        Ok(state.active || !state.waiters.is_empty() || state.granted_waiter.is_some())
    }

    fn release(&self) {
        let wake = self.state.lock().ok().and_then(|mut state| advance_connection_test_queue(&mut state));
        if let Some(waker) = wake {
            waker.wake();
        }
    }
}

fn advance_connection_test_queue(state: &mut ConnectionTestQueueState) -> Option<Waker> {
    state.granted_waiter = None;
    if let Some(waiter) = state.waiters.pop_front() {
        state.active = true;
        state.granted_waiter = Some(waiter.id);
        Some(waiter.waker)
    }
    else {
        state.active = false;
        None
    }
}

impl Future for ConnectionTestAcquire {
    type Output = Result<ConnectionTestPermit, String>;

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        let queue = self.queue.clone();
        let mut state = match queue.state.lock() {
            Ok(state) => state,
            Err(_) => return Poll::Ready(Err("测试连接状态异常".to_string())),
        };

        if let Some(waiter_id) = self.waiter_id {
            if state.granted_waiter == Some(waiter_id) {
                state.granted_waiter = None;
                self.acquired = true;
                self.waiter_id = None;
                drop(state);
                return Poll::Ready(Ok(ConnectionTestPermit { queue }));
            }
            if let Some(waiter) = state.waiters.iter_mut().find(|waiter| waiter.id == waiter_id) {
                waiter.waker = context.waker().clone();
                return Poll::Pending;
            }
            return Poll::Ready(Err("测试连接队列状态异常".to_string()));
        }

        if !state.active && state.waiters.is_empty() && state.granted_waiter.is_none() {
            state.active = true;
            self.acquired = true;
            drop(state);
            return Poll::Ready(Ok(ConnectionTestPermit { queue }));
        }

        let waiter_id = state.next_waiter_id;
        state.next_waiter_id = state.next_waiter_id.wrapping_add(1);
        state.waiters.push_back(ConnectionTestWaiter {
            id: waiter_id,
            waker: context.waker().clone(),
        });
        self.waiter_id = Some(waiter_id);
        Poll::Pending
    }
}

impl Drop for ConnectionTestAcquire {
    fn drop(&mut self) {
        if self.acquired {
            return;
        }
        let Some(waiter_id) = self.waiter_id else {
            return;
        };
        let wake = self.queue.state.lock().ok().and_then(|mut state| {
            if state.granted_waiter == Some(waiter_id) {
                advance_connection_test_queue(&mut state)
            }
            else {
                state.waiters.retain(|waiter| waiter.id != waiter_id);
                None
            }
        });
        if let Some(waker) = wake {
            waker.wake();
        }
    }
}

pub(crate) struct ResolvedProvider {
    pub base_url: String,
    pub model_id: String,
    pub api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionTestResult {
    ok: bool,
    model_id: String,
    latency_ms: u64,
}

impl ModelProviderStore {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
        fs::create_dir_all(&app_data_dir)
            .map_err(|error| format!("无法创建模型服务商设置目录：{error}"))?;
        let store = Self {
            registry_path: app_data_dir.join("model-providers-v1.json"),
            recovery_path: app_data_dir.join("model-providers-recovery-v1.json"),
            publisher: Arc::new(NativeRegistryPublisher),
            credentials: Arc::new(WindowsProviderCredentials),
            connection_test_queue: Arc::new(ConnectionTestQueue::default()),
        };
        Ok(store)
    }

    #[cfg(test)]
    fn begin_connection_test(&self, profile_id: &str) -> Result<ConnectionTestPermit, String> {
        parse_uuid(profile_id, "配置 ID")?;
        self.connection_test_queue.try_acquire()
    }

    fn ensure_mutation_allowed(&self) -> Result<(), String> {
        if self.connection_test_queue.is_busy()? {
            return Err("测试连接进行中，暂不能修改或清理模型服务商配置".to_string());
        }
        Ok(())
    }

    fn prepare_connection_test(
        &self,
        profile_id: &str,
    ) -> Result<(String, Arc<ConnectionTestQueue>), String> {
        let profile_id = parse_uuid(profile_id, "配置 ID")?.hyphenated().to_string();
        Ok((profile_id, self.connection_test_queue.clone()))
    }

    fn credential_exists(&self, profile_id: &str) -> Result<bool, String> {
        Ok(self.credentials.exists(profile_id).unwrap_or(false))
    }

    pub(crate) fn resolve_for_inference(&self, profile_id: &str) -> Result<ResolvedProvider, String> {
        let id = parse_uuid(profile_id, "配置 ID")?.hyphenated().to_string();
        let registry = self.load()?;
        let profile = registry
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| "模型服务商配置不存在".to_string())?;
        let is_local = is_local_base_url(&profile.base_url)?;
        let api_key = self.credentials.read(&id)?;
        if !is_local && api_key.is_none() {
            return Err("远程模型服务商需要先保存 API Key".to_string());
        }
        Ok(ResolvedProvider {
            base_url: profile.base_url.clone(),
            model_id: profile.model_id.clone(),
            api_key,
        })
    }

    fn save_credential(&self, profile_id: &str, secret: &str) -> Result<(), String> {
        self.credentials.save(profile_id, secret)
    }

    fn delete_credential(&self, profile_id: &str) -> Result<(), String> {
        self.credentials.delete(profile_id)
    }

    fn load(&self) -> Result<ProviderRegistryV1, String> {
        if !self.registry_path.exists() {
            let registry = ProviderRegistryV1::default();
            self.publish(&registry)?;
            return Ok(registry);
        }

        let metadata = fs::metadata(&self.registry_path)
            .map_err(|error| format!("无法读取模型服务商设置：{error}"))?;
        if metadata.len() > MAX_REGISTRY_BYTES {
            return Err(format!(
                "模型服务商设置超过 {} 字节限制",
                MAX_REGISTRY_BYTES
            ));
        }
        let bytes = fs::read(&self.registry_path)
            .map_err(|error| format!("无法读取模型服务商设置：{error}"))?;
        match parse_registry(&bytes) {
            Ok(registry) => Ok(registry),
            Err(error) => {
                self.back_up_corrupted_registry(&bytes)?;
                Err(format!(
                    "模型服务商设置已损坏，原始内容已逐字节备份到恢复文件：{error}"
                ))
            }
        }
    }

    fn back_up_corrupted_registry(&self, original_bytes: &[u8]) -> Result<(), String> {
        let mut recovery = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&self.recovery_path)
            .map_err(|error| format!("无法创建模型服务商设置恢复备份：{error}"))?;
        recovery
            .write_all(original_bytes)
            .and_then(|_| recovery.sync_all())
            .map_err(|error| format!("无法写入模型服务商设置恢复备份：{error}"))?;
        drop(recovery);

        let recovered = fs::read(&self.recovery_path)
            .map_err(|error| format!("无法验证模型服务商设置恢复备份：{error}"))?;
        if recovered != original_bytes {
            return Err("模型服务商设置恢复备份未能逐字节保留原文件".to_string());
        }
        Ok(())
    }

    fn publish(&self, registry: &ProviderRegistryV1) -> Result<(), String> {
        let normalized = normalized_registry(registry)?;
        let mut bytes = serde_json::to_vec_pretty(&normalized)
            .map_err(|error| format!("无法序列化模型服务商设置：{error}"))?;
        bytes.push(b'\n');
        if bytes.len() as u64 > MAX_REGISTRY_BYTES {
            return Err(format!(
                "模型服务商设置超过 {} 字节限制",
                MAX_REGISTRY_BYTES
            ));
        }

        let mut temporary_name = self
            .registry_path
            .file_name()
            .unwrap_or_default()
            .to_os_string();
        temporary_name.push(format!(".{}.tmp", Uuid::new_v4()));
        let temporary_path = self.registry_path.with_file_name(temporary_name);
        let result = (|| {
            let mut temporary = File::create(&temporary_path)
                .map_err(|error| format!("无法创建模型服务商临时设置：{error}"))?;
            temporary
                .write_all(&bytes)
                .and_then(|_| temporary.sync_all())
                .map_err(|error| format!("无法同步模型服务商临时设置：{error}"))?;
            drop(temporary);

            let written = fs::read(&temporary_path)
                .map_err(|error| format!("无法验证模型服务商临时设置：{error}"))?;
            if written != bytes {
                return Err("模型服务商临时设置写入不完整".to_string());
            }
            parse_registry(&written)
                .map_err(|error| format!("模型服务商临时设置校验失败：{error}"))?;
            self.publisher
                .publish(&temporary_path, &self.registry_path)
        })();

        if result.is_err() && temporary_path.is_file() {
            let _ = fs::remove_file(&temporary_path);
        }
        result
    }

    fn list(&self) -> Result<ProviderListDto, String> {
        let registry = self.load()?;
        self.dto_list(&registry)
    }

    fn create(&self, mut input: CreateProviderInput, timestamp: &str) -> Result<ProviderProfileDto, String> {
        let mut secret = input.api_key.take().map(OwnedProviderSecret::new);
        self.create_guarded(input, secret.as_mut(), timestamp)
    }

    fn create_guarded(
        &self,
        input: CreateProviderInput,
        secret: Option<&mut OwnedProviderSecret>,
        timestamp: &str,
    ) -> Result<ProviderProfileDto, String> {
        self.ensure_mutation_allowed()?;
        validate_timestamp(timestamp, "创建时间")?;
        let mut registry = self.load()?;
        if registry.profiles.len() >= MAX_PROFILES {
            return Err(format!("模型服务商配置不能超过 {MAX_PROFILES} 个"));
        }
        let id = Uuid::new_v4().hyphenated().to_string();
        registry.profiles.push(ProviderProfile {
            id: id.clone(),
            name: input.name,
            base_url: input.base_url,
            model_id: input.model_id,
            credential_generation: 0,
            created_at: timestamp.to_string(),
            updated_at: timestamp.to_string(),
        });
        self.publish(&registry)?;
        if let Some(secret) = secret {
            self.save_credential(&id, secret.as_str())?;
        }
        self.profile_dto_by_id(&self.load()?, &id)
    }

    fn update(&self, id: &str, input: UpdateProviderInput, timestamp: &str) -> Result<ProviderProfileDto, String> {
        self.ensure_mutation_allowed()?;
        let id = parse_uuid(id, "配置 ID")?.hyphenated().to_string();
        validate_timestamp(timestamp, "更新时间")?;
        let mut registry = self.load()?;
        let profile = registry.profiles.iter_mut().find(|profile| profile.id == id)
            .ok_or_else(|| "模型服务商配置不存在".to_string())?;
        profile.name = input.name;
        profile.base_url = input.base_url;
        profile.model_id = input.model_id;
        profile.updated_at = timestamp.to_string();
        self.publish(&registry)?;
        self.profile_dto_by_id(&self.load()?, &id)
    }

    fn replace_api_key(&self, id: &str, api_key: String) -> Result<ProviderProfileDto, String> {
        let mut secret = OwnedProviderSecret::new(api_key);
        self.replace_api_key_guarded(id, &mut secret)
    }

    fn replace_api_key_guarded(
        &self,
        id: &str,
        secret: &mut OwnedProviderSecret,
    ) -> Result<ProviderProfileDto, String> {
        self.ensure_mutation_allowed()?;
        let id = parse_uuid(id, "配置 ID")?.hyphenated().to_string();
        let mut registry = self.load()?;
        let profile = registry
            .profiles
            .iter_mut()
            .find(|profile| profile.id == id)
            .ok_or_else(|| "模型服务商配置不存在".to_string())?;
        if profile.credential_generation >= MAX_CREDENTIAL_GENERATION {
            return Err("模型服务商换钥次数已达到安全上限".to_string());
        }
        let next_generation = profile.credential_generation + 1;
        profile.credential_generation = next_generation;
        self.publish(&registry)?;
        self.save_credential(&id, secret.as_str())?;
        self.profile_dto_by_id(&registry, &id)
    }

    fn delete(&self, id: &str) -> Result<ProviderListDto, String> {
        self.ensure_mutation_allowed()?;
        let id = parse_uuid(id, "配置 ID")?.hyphenated().to_string();
        let mut registry = self.load()?;
        let profile_index = registry.profiles.iter().position(|profile| profile.id == id)
            .ok_or_else(|| "模型服务商配置不存在".to_string())?;
        registry.profiles.remove(profile_index);
        registry.pending_credential_deletes.push(id.clone());
        self.publish(&registry)?;

        self.delete_credential(&id)?;
        registry.pending_credential_deletes.retain(|pending_id| pending_id != &id);
        self.publish(&registry)?;
        self.dto_list(&registry)
    }

    fn retry_credential_cleanup(&self, id: &str) -> Result<ProviderListDto, String> {
        self.ensure_mutation_allowed()?;
        let id = parse_uuid(id, "待删除凭据 ID")?.hyphenated().to_string();
        let mut registry = self.load()?;
        if !registry.pending_credential_deletes.iter().any(|pending_id| pending_id == &id) {
            return Err("该模型服务商没有待清理凭据".to_string());
        }
        self.delete_credential(&id)?;
        registry.pending_credential_deletes.retain(|pending_id| pending_id != &id);
        self.publish(&registry)?;
        self.dto_list(&registry)
    }

    fn retry_pending_credential_cleanup(&self) -> Result<(), String> {
        self.ensure_mutation_allowed()?;
        let mut registry = self.load()?;
        let pending = registry.pending_credential_deletes.clone();
        let mut changed = false;
        for id in pending {
            if self.delete_credential(&id).is_ok() {
                registry.pending_credential_deletes.retain(|pending_id| pending_id != &id);
                changed = true;
            }
        }
        if changed {
            self.publish(&registry)?;
        }
        Ok(())
    }

    fn dto_list(&self, registry: &ProviderRegistryV1) -> Result<ProviderListDto, String> {
        let profiles = registry.profiles.iter().map(|profile| self.profile_dto(profile))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ProviderListDto {
            profiles,
            pending_credential_deletes: registry.pending_credential_deletes.clone(),
        })
    }

    fn profile_dto_by_id(&self, registry: &ProviderRegistryV1, id: &str) -> Result<ProviderProfileDto, String> {
        let profile = registry.profiles.iter().find(|profile| profile.id == id)
            .ok_or_else(|| "模型服务商配置不存在".to_string())?;
        self.profile_dto(profile)
    }

    fn profile_dto(&self, profile: &ProviderProfile) -> Result<ProviderProfileDto, String> {
        Ok(ProviderProfileDto {
            id: profile.id.clone(),
            name: profile.name.clone(),
            base_url: profile.base_url.clone(),
            model_id: profile.model_id.clone(),
            credential_generation: profile.credential_generation,
            has_credential: self.credential_exists(&profile.id)?,
            is_local: is_local_base_url(&profile.base_url)?,
            created_at: profile.created_at.clone(),
            updated_at: profile.updated_at.clone(),
        })
    }
}

fn with_lifecycle_store<T>(state: &Mutex<ModelProviderStore>, operation: impl FnOnce(&ModelProviderStore) -> Result<T, String>) -> Result<T, String> {
    let store = state.lock().map_err(|_| "模型服务商生命周期队列不可用".to_string())?;
    operation(&store)
}

pub(crate) fn resolve_provider_for_inference(
    state: &Mutex<ModelProviderStore>,
    id: &str,
) -> Result<ResolvedProvider, String> {
    with_lifecycle_store(state, |store| store.resolve_for_inference(id))
}

async fn run_connection_test_with<T, Operation, OperationFuture>(
    state: &Mutex<ModelProviderStore>,
    id: &str,
    operation: Operation,
) -> Result<T, String>
where
    Operation: FnOnce(ResolvedProvider) -> OperationFuture,
    OperationFuture: Future<Output = Result<T, String>>,
{
    let (profile_id, queue) = with_lifecycle_store(state, |store| {
        store.prepare_connection_test(id)
    })?;
    let _permit = queue.acquire().await?;
    let provider = with_lifecycle_store(state, |store| {
        store.resolve_for_inference(&profile_id)
    })?;
    operation(provider).await
}

#[tauri::command]
pub fn model_provider_list(store: State<'_, Mutex<ModelProviderStore>>) -> Result<ProviderListDto, String> {
    with_lifecycle_store(&store, ModelProviderStore::list)
}

#[tauri::command]
pub fn model_provider_create(store: State<'_, Mutex<ModelProviderStore>>, mut input: CreateProviderInput) -> Result<ProviderProfileDto, String> {
    let mut secret = input.api_key.take().map(OwnedProviderSecret::new);
    let timestamp = current_timestamp()?;
    with_lifecycle_store(&store, move |store| {
        store.create_guarded(input, secret.as_mut(), &timestamp)
    })
}

#[tauri::command]
pub fn model_provider_update(store: State<'_, Mutex<ModelProviderStore>>, id: String, input: UpdateProviderInput) -> Result<ProviderProfileDto, String> {
    let timestamp = current_timestamp()?;
    with_lifecycle_store(&store, |store| store.update(&id, input, &timestamp))
}

#[tauri::command]
pub fn model_provider_replace_api_key(store: State<'_, Mutex<ModelProviderStore>>, id: String, api_key: String) -> Result<ProviderProfileDto, String> {
    let mut secret = OwnedProviderSecret::new(api_key);
    with_lifecycle_store(&store, move |store| {
        store.replace_api_key_guarded(&id, &mut secret)
    })
}

#[tauri::command]
pub fn model_provider_delete(store: State<'_, Mutex<ModelProviderStore>>, id: String) -> Result<ProviderListDto, String> {
    with_lifecycle_store(&store, |store| store.delete(&id))
}

#[tauri::command]
pub fn model_provider_retry_credential_cleanup(store: State<'_, Mutex<ModelProviderStore>>, id: String) -> Result<ProviderListDto, String> {
    with_lifecycle_store(&store, |store| store.retry_credential_cleanup(&id))
}

#[tauri::command]
pub async fn model_provider_test_connection(
    store: State<'_, Mutex<ModelProviderStore>>,
    id: String,
) -> Result<ProviderConnectionTestResult, String> {
    let started = Instant::now();
    let model_id = run_connection_test_with(&store, &id, |provider| async move {
        let model_id = provider.model_id.clone();
        crate::openai_compatible::test_connection(
            &provider.base_url,
            provider.api_key,
            &provider.model_id,
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok(model_id)
    }).await?;
    Ok(ProviderConnectionTestResult {
        ok: true,
        model_id,
        latency_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    })
}

fn current_timestamp() -> Result<String, String> {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时间早于 Unix 纪元".to_string())?;
    let seconds = elapsed.as_secs();
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_date_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    Ok(format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{:03}Z", elapsed.subsec_millis()))
}

fn civil_date_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let shifted = days_since_epoch + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month as u32, day as u32)
}

fn parse_registry(bytes: &[u8]) -> Result<ProviderRegistryV1, String> {
    if bytes.len() as u64 > MAX_REGISTRY_BYTES {
        return Err(format!(
            "模型服务商设置超过 {} 字节限制",
            MAX_REGISTRY_BYTES
        ));
    }
    let registry: ProviderRegistryV1 = serde_json::from_slice(bytes)
        .map_err(|error| format!("模型服务商设置 JSON 无效：{error}"))?;
    validate_registry(&registry)?;
    Ok(registry)
}

fn normalized_registry(registry: &ProviderRegistryV1) -> Result<ProviderRegistryV1, String> {
    validate_registry(registry)?;
    let mut normalized = registry.clone();
    for profile in &mut normalized.profiles {
        profile.id = parse_uuid(&profile.id, "配置 ID")?.hyphenated().to_string();
        profile.base_url = normalize_base_url(&profile.base_url)?;
    }
    for id in &mut normalized.pending_credential_deletes {
        *id = parse_uuid(id, "待删除凭据 ID")?.hyphenated().to_string();
    }
    Ok(normalized)
}

fn validate_registry(registry: &ProviderRegistryV1) -> Result<(), String> {
    if registry.version != REGISTRY_VERSION {
        return Err(format!(
            "模型服务商设置版本 {} 无效，当前仅接受版本 {}",
            registry.version, REGISTRY_VERSION
        ));
    }
    if registry.profiles.len() > MAX_PROFILES {
        return Err(format!("模型服务商配置不能超过 {MAX_PROFILES} 个"));
    }
    if registry.pending_credential_deletes.len() > MAX_PENDING_CREDENTIAL_DELETES {
        return Err(format!(
            "待删除凭据不能超过 {MAX_PENDING_CREDENTIAL_DELETES} 个"
        ));
    }

    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for profile in &registry.profiles {
        let id = parse_canonical_uuid(&profile.id, "配置 ID")?;
        if !ids.insert(id) {
            return Err("模型服务商配置 ID 不能重复".to_string());
        }
        validate_bounded_text(&profile.name, "配置名称", MAX_NAME_CHARS)?;
        let folded_name = provider_name_casefold(&profile.name);
        if !names.insert(folded_name) {
            return Err("模型服务商配置名称不能重复（不区分大小写）".to_string());
        }
        validate_bounded_text(&profile.model_id, "模型 ID", MAX_MODEL_ID_CHARS)?;
        if profile.credential_generation > MAX_CREDENTIAL_GENERATION {
            return Err("凭据代次必须位于 JavaScript 安全整数范围内".to_string());
        }
        normalize_base_url(&profile.base_url)?;
        validate_timestamp(&profile.created_at, "创建时间")?;
        validate_timestamp(&profile.updated_at, "更新时间")?;
    }

    let mut pending_ids = HashSet::new();
    for id in &registry.pending_credential_deletes {
        let parsed_id = parse_canonical_uuid(id, "待删除凭据 ID")?;
        if ids.contains(&parsed_id) {
            return Err("待删除凭据不能属于仍启用的模型服务商配置".to_string());
        }
        if !pending_ids.insert(parsed_id) {
            return Err("待删除凭据 ID 不能重复".to_string());
        }
    }
    Ok(())
}

fn parse_uuid(value: &str, field: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| format!("{field} 必须是有效 UUID"))
}

fn parse_canonical_uuid(value: &str, field: &str) -> Result<Uuid, String> {
    let parsed = parse_uuid(value, field)?;
    if value != parsed.hyphenated().to_string() {
        return Err(format!("{field} 必须使用小写连字符规范 UUID"));
    }
    Ok(parsed)
}

// Generated from CPython 3.14.5 `str.casefold()` with Unicode 16.0.0.
// These are exactly the code points whose casefold differs from `str.lower()`.
// Regenerate to stdout without network access:
// py -3.14 -c "import sys,unicodedata; assert unicodedata.unidata_version=='16.0.0'; print(*[(f'U+{cp:04X}', chr(cp).casefold().encode('unicode_escape').decode()) for cp in range(sys.maxunicode+1) if chr(cp).casefold()!=chr(cp).lower()], sep='\\n')"
const PROVIDER_NAME_CASEFOLD_EXCEPTIONS: [(char, &str); 297] = [
('\u{b5}', "\u{3bc}"),
    ('\u{df}', "\u{73}\u{73}"),
    ('\u{149}', "\u{2bc}\u{6e}"),
    ('\u{17f}', "\u{73}"),
    ('\u{1f0}', "\u{6a}\u{30c}"),
    ('\u{345}', "\u{3b9}"),
    ('\u{390}', "\u{3b9}\u{308}\u{301}"),
    ('\u{3b0}', "\u{3c5}\u{308}\u{301}"),
    ('\u{3c2}', "\u{3c3}"),
    ('\u{3d0}', "\u{3b2}"),
    ('\u{3d1}', "\u{3b8}"),
    ('\u{3d5}', "\u{3c6}"),
    ('\u{3d6}', "\u{3c0}"),
    ('\u{3f0}', "\u{3ba}"),
    ('\u{3f1}', "\u{3c1}"),
    ('\u{3f5}', "\u{3b5}"),
    ('\u{587}', "\u{565}\u{582}"),
    ('\u{13a0}', "\u{13a0}"),
    ('\u{13a1}', "\u{13a1}"),
    ('\u{13a2}', "\u{13a2}"),
    ('\u{13a3}', "\u{13a3}"),
    ('\u{13a4}', "\u{13a4}"),
    ('\u{13a5}', "\u{13a5}"),
    ('\u{13a6}', "\u{13a6}"),
    ('\u{13a7}', "\u{13a7}"),
    ('\u{13a8}', "\u{13a8}"),
    ('\u{13a9}', "\u{13a9}"),
    ('\u{13aa}', "\u{13aa}"),
    ('\u{13ab}', "\u{13ab}"),
    ('\u{13ac}', "\u{13ac}"),
    ('\u{13ad}', "\u{13ad}"),
    ('\u{13ae}', "\u{13ae}"),
    ('\u{13af}', "\u{13af}"),
    ('\u{13b0}', "\u{13b0}"),
    ('\u{13b1}', "\u{13b1}"),
    ('\u{13b2}', "\u{13b2}"),
    ('\u{13b3}', "\u{13b3}"),
    ('\u{13b4}', "\u{13b4}"),
    ('\u{13b5}', "\u{13b5}"),
    ('\u{13b6}', "\u{13b6}"),
    ('\u{13b7}', "\u{13b7}"),
    ('\u{13b8}', "\u{13b8}"),
    ('\u{13b9}', "\u{13b9}"),
    ('\u{13ba}', "\u{13ba}"),
    ('\u{13bb}', "\u{13bb}"),
    ('\u{13bc}', "\u{13bc}"),
    ('\u{13bd}', "\u{13bd}"),
    ('\u{13be}', "\u{13be}"),
    ('\u{13bf}', "\u{13bf}"),
    ('\u{13c0}', "\u{13c0}"),
    ('\u{13c1}', "\u{13c1}"),
    ('\u{13c2}', "\u{13c2}"),
    ('\u{13c3}', "\u{13c3}"),
    ('\u{13c4}', "\u{13c4}"),
    ('\u{13c5}', "\u{13c5}"),
    ('\u{13c6}', "\u{13c6}"),
    ('\u{13c7}', "\u{13c7}"),
    ('\u{13c8}', "\u{13c8}"),
    ('\u{13c9}', "\u{13c9}"),
    ('\u{13ca}', "\u{13ca}"),
    ('\u{13cb}', "\u{13cb}"),
    ('\u{13cc}', "\u{13cc}"),
    ('\u{13cd}', "\u{13cd}"),
    ('\u{13ce}', "\u{13ce}"),
    ('\u{13cf}', "\u{13cf}"),
    ('\u{13d0}', "\u{13d0}"),
    ('\u{13d1}', "\u{13d1}"),
    ('\u{13d2}', "\u{13d2}"),
    ('\u{13d3}', "\u{13d3}"),
    ('\u{13d4}', "\u{13d4}"),
    ('\u{13d5}', "\u{13d5}"),
    ('\u{13d6}', "\u{13d6}"),
    ('\u{13d7}', "\u{13d7}"),
    ('\u{13d8}', "\u{13d8}"),
    ('\u{13d9}', "\u{13d9}"),
    ('\u{13da}', "\u{13da}"),
    ('\u{13db}', "\u{13db}"),
    ('\u{13dc}', "\u{13dc}"),
    ('\u{13dd}', "\u{13dd}"),
    ('\u{13de}', "\u{13de}"),
    ('\u{13df}', "\u{13df}"),
    ('\u{13e0}', "\u{13e0}"),
    ('\u{13e1}', "\u{13e1}"),
    ('\u{13e2}', "\u{13e2}"),
    ('\u{13e3}', "\u{13e3}"),
    ('\u{13e4}', "\u{13e4}"),
    ('\u{13e5}', "\u{13e5}"),
    ('\u{13e6}', "\u{13e6}"),
    ('\u{13e7}', "\u{13e7}"),
    ('\u{13e8}', "\u{13e8}"),
    ('\u{13e9}', "\u{13e9}"),
    ('\u{13ea}', "\u{13ea}"),
    ('\u{13eb}', "\u{13eb}"),
    ('\u{13ec}', "\u{13ec}"),
    ('\u{13ed}', "\u{13ed}"),
    ('\u{13ee}', "\u{13ee}"),
    ('\u{13ef}', "\u{13ef}"),
    ('\u{13f0}', "\u{13f0}"),
    ('\u{13f1}', "\u{13f1}"),
    ('\u{13f2}', "\u{13f2}"),
    ('\u{13f3}', "\u{13f3}"),
    ('\u{13f4}', "\u{13f4}"),
    ('\u{13f5}', "\u{13f5}"),
    ('\u{13f8}', "\u{13f0}"),
    ('\u{13f9}', "\u{13f1}"),
    ('\u{13fa}', "\u{13f2}"),
    ('\u{13fb}', "\u{13f3}"),
    ('\u{13fc}', "\u{13f4}"),
    ('\u{13fd}', "\u{13f5}"),
    ('\u{1c80}', "\u{432}"),
    ('\u{1c81}', "\u{434}"),
    ('\u{1c82}', "\u{43e}"),
    ('\u{1c83}', "\u{441}"),
    ('\u{1c84}', "\u{442}"),
    ('\u{1c85}', "\u{442}"),
    ('\u{1c86}', "\u{44a}"),
    ('\u{1c87}', "\u{463}"),
    ('\u{1c88}', "\u{a64b}"),
    ('\u{1e96}', "\u{68}\u{331}"),
    ('\u{1e97}', "\u{74}\u{308}"),
    ('\u{1e98}', "\u{77}\u{30a}"),
    ('\u{1e99}', "\u{79}\u{30a}"),
    ('\u{1e9a}', "\u{61}\u{2be}"),
    ('\u{1e9b}', "\u{1e61}"),
    ('\u{1e9e}', "\u{73}\u{73}"),
    ('\u{1f50}', "\u{3c5}\u{313}"),
    ('\u{1f52}', "\u{3c5}\u{313}\u{300}"),
    ('\u{1f54}', "\u{3c5}\u{313}\u{301}"),
    ('\u{1f56}', "\u{3c5}\u{313}\u{342}"),
    ('\u{1f80}', "\u{1f00}\u{3b9}"),
    ('\u{1f81}', "\u{1f01}\u{3b9}"),
    ('\u{1f82}', "\u{1f02}\u{3b9}"),
    ('\u{1f83}', "\u{1f03}\u{3b9}"),
    ('\u{1f84}', "\u{1f04}\u{3b9}"),
    ('\u{1f85}', "\u{1f05}\u{3b9}"),
    ('\u{1f86}', "\u{1f06}\u{3b9}"),
    ('\u{1f87}', "\u{1f07}\u{3b9}"),
    ('\u{1f88}', "\u{1f00}\u{3b9}"),
    ('\u{1f89}', "\u{1f01}\u{3b9}"),
    ('\u{1f8a}', "\u{1f02}\u{3b9}"),
    ('\u{1f8b}', "\u{1f03}\u{3b9}"),
    ('\u{1f8c}', "\u{1f04}\u{3b9}"),
    ('\u{1f8d}', "\u{1f05}\u{3b9}"),
    ('\u{1f8e}', "\u{1f06}\u{3b9}"),
    ('\u{1f8f}', "\u{1f07}\u{3b9}"),
    ('\u{1f90}', "\u{1f20}\u{3b9}"),
    ('\u{1f91}', "\u{1f21}\u{3b9}"),
    ('\u{1f92}', "\u{1f22}\u{3b9}"),
    ('\u{1f93}', "\u{1f23}\u{3b9}"),
    ('\u{1f94}', "\u{1f24}\u{3b9}"),
    ('\u{1f95}', "\u{1f25}\u{3b9}"),
    ('\u{1f96}', "\u{1f26}\u{3b9}"),
    ('\u{1f97}', "\u{1f27}\u{3b9}"),
    ('\u{1f98}', "\u{1f20}\u{3b9}"),
    ('\u{1f99}', "\u{1f21}\u{3b9}"),
    ('\u{1f9a}', "\u{1f22}\u{3b9}"),
    ('\u{1f9b}', "\u{1f23}\u{3b9}"),
    ('\u{1f9c}', "\u{1f24}\u{3b9}"),
    ('\u{1f9d}', "\u{1f25}\u{3b9}"),
    ('\u{1f9e}', "\u{1f26}\u{3b9}"),
    ('\u{1f9f}', "\u{1f27}\u{3b9}"),
    ('\u{1fa0}', "\u{1f60}\u{3b9}"),
    ('\u{1fa1}', "\u{1f61}\u{3b9}"),
    ('\u{1fa2}', "\u{1f62}\u{3b9}"),
    ('\u{1fa3}', "\u{1f63}\u{3b9}"),
    ('\u{1fa4}', "\u{1f64}\u{3b9}"),
    ('\u{1fa5}', "\u{1f65}\u{3b9}"),
    ('\u{1fa6}', "\u{1f66}\u{3b9}"),
    ('\u{1fa7}', "\u{1f67}\u{3b9}"),
    ('\u{1fa8}', "\u{1f60}\u{3b9}"),
    ('\u{1fa9}', "\u{1f61}\u{3b9}"),
    ('\u{1faa}', "\u{1f62}\u{3b9}"),
    ('\u{1fab}', "\u{1f63}\u{3b9}"),
    ('\u{1fac}', "\u{1f64}\u{3b9}"),
    ('\u{1fad}', "\u{1f65}\u{3b9}"),
    ('\u{1fae}', "\u{1f66}\u{3b9}"),
    ('\u{1faf}', "\u{1f67}\u{3b9}"),
    ('\u{1fb2}', "\u{1f70}\u{3b9}"),
    ('\u{1fb3}', "\u{3b1}\u{3b9}"),
    ('\u{1fb4}', "\u{3ac}\u{3b9}"),
    ('\u{1fb6}', "\u{3b1}\u{342}"),
    ('\u{1fb7}', "\u{3b1}\u{342}\u{3b9}"),
    ('\u{1fbc}', "\u{3b1}\u{3b9}"),
    ('\u{1fbe}', "\u{3b9}"),
    ('\u{1fc2}', "\u{1f74}\u{3b9}"),
    ('\u{1fc3}', "\u{3b7}\u{3b9}"),
    ('\u{1fc4}', "\u{3ae}\u{3b9}"),
    ('\u{1fc6}', "\u{3b7}\u{342}"),
    ('\u{1fc7}', "\u{3b7}\u{342}\u{3b9}"),
    ('\u{1fcc}', "\u{3b7}\u{3b9}"),
    ('\u{1fd2}', "\u{3b9}\u{308}\u{300}"),
    ('\u{1fd3}', "\u{3b9}\u{308}\u{301}"),
    ('\u{1fd6}', "\u{3b9}\u{342}"),
    ('\u{1fd7}', "\u{3b9}\u{308}\u{342}"),
    ('\u{1fe2}', "\u{3c5}\u{308}\u{300}"),
    ('\u{1fe3}', "\u{3c5}\u{308}\u{301}"),
    ('\u{1fe4}', "\u{3c1}\u{313}"),
    ('\u{1fe6}', "\u{3c5}\u{342}"),
    ('\u{1fe7}', "\u{3c5}\u{308}\u{342}"),
    ('\u{1ff2}', "\u{1f7c}\u{3b9}"),
    ('\u{1ff3}', "\u{3c9}\u{3b9}"),
    ('\u{1ff4}', "\u{3ce}\u{3b9}"),
    ('\u{1ff6}', "\u{3c9}\u{342}"),
    ('\u{1ff7}', "\u{3c9}\u{342}\u{3b9}"),
    ('\u{1ffc}', "\u{3c9}\u{3b9}"),
    ('\u{ab70}', "\u{13a0}"),
    ('\u{ab71}', "\u{13a1}"),
    ('\u{ab72}', "\u{13a2}"),
    ('\u{ab73}', "\u{13a3}"),
    ('\u{ab74}', "\u{13a4}"),
    ('\u{ab75}', "\u{13a5}"),
    ('\u{ab76}', "\u{13a6}"),
    ('\u{ab77}', "\u{13a7}"),
    ('\u{ab78}', "\u{13a8}"),
    ('\u{ab79}', "\u{13a9}"),
    ('\u{ab7a}', "\u{13aa}"),
    ('\u{ab7b}', "\u{13ab}"),
    ('\u{ab7c}', "\u{13ac}"),
    ('\u{ab7d}', "\u{13ad}"),
    ('\u{ab7e}', "\u{13ae}"),
    ('\u{ab7f}', "\u{13af}"),
    ('\u{ab80}', "\u{13b0}"),
    ('\u{ab81}', "\u{13b1}"),
    ('\u{ab82}', "\u{13b2}"),
    ('\u{ab83}', "\u{13b3}"),
    ('\u{ab84}', "\u{13b4}"),
    ('\u{ab85}', "\u{13b5}"),
    ('\u{ab86}', "\u{13b6}"),
    ('\u{ab87}', "\u{13b7}"),
    ('\u{ab88}', "\u{13b8}"),
    ('\u{ab89}', "\u{13b9}"),
    ('\u{ab8a}', "\u{13ba}"),
    ('\u{ab8b}', "\u{13bb}"),
    ('\u{ab8c}', "\u{13bc}"),
    ('\u{ab8d}', "\u{13bd}"),
    ('\u{ab8e}', "\u{13be}"),
    ('\u{ab8f}', "\u{13bf}"),
    ('\u{ab90}', "\u{13c0}"),
    ('\u{ab91}', "\u{13c1}"),
    ('\u{ab92}', "\u{13c2}"),
    ('\u{ab93}', "\u{13c3}"),
    ('\u{ab94}', "\u{13c4}"),
    ('\u{ab95}', "\u{13c5}"),
    ('\u{ab96}', "\u{13c6}"),
    ('\u{ab97}', "\u{13c7}"),
    ('\u{ab98}', "\u{13c8}"),
    ('\u{ab99}', "\u{13c9}"),
    ('\u{ab9a}', "\u{13ca}"),
    ('\u{ab9b}', "\u{13cb}"),
    ('\u{ab9c}', "\u{13cc}"),
    ('\u{ab9d}', "\u{13cd}"),
    ('\u{ab9e}', "\u{13ce}"),
    ('\u{ab9f}', "\u{13cf}"),
    ('\u{aba0}', "\u{13d0}"),
    ('\u{aba1}', "\u{13d1}"),
    ('\u{aba2}', "\u{13d2}"),
    ('\u{aba3}', "\u{13d3}"),
    ('\u{aba4}', "\u{13d4}"),
    ('\u{aba5}', "\u{13d5}"),
    ('\u{aba6}', "\u{13d6}"),
    ('\u{aba7}', "\u{13d7}"),
    ('\u{aba8}', "\u{13d8}"),
    ('\u{aba9}', "\u{13d9}"),
    ('\u{abaa}', "\u{13da}"),
    ('\u{abab}', "\u{13db}"),
    ('\u{abac}', "\u{13dc}"),
    ('\u{abad}', "\u{13dd}"),
    ('\u{abae}', "\u{13de}"),
    ('\u{abaf}', "\u{13df}"),
    ('\u{abb0}', "\u{13e0}"),
    ('\u{abb1}', "\u{13e1}"),
    ('\u{abb2}', "\u{13e2}"),
    ('\u{abb3}', "\u{13e3}"),
    ('\u{abb4}', "\u{13e4}"),
    ('\u{abb5}', "\u{13e5}"),
    ('\u{abb6}', "\u{13e6}"),
    ('\u{abb7}', "\u{13e7}"),
    ('\u{abb8}', "\u{13e8}"),
    ('\u{abb9}', "\u{13e9}"),
    ('\u{abba}', "\u{13ea}"),
    ('\u{abbb}', "\u{13eb}"),
    ('\u{abbc}', "\u{13ec}"),
    ('\u{abbd}', "\u{13ed}"),
    ('\u{abbe}', "\u{13ee}"),
    ('\u{abbf}', "\u{13ef}"),
    ('\u{fb00}', "\u{66}\u{66}"),
    ('\u{fb01}', "\u{66}\u{69}"),
    ('\u{fb02}', "\u{66}\u{6c}"),
    ('\u{fb03}', "\u{66}\u{66}\u{69}"),
    ('\u{fb04}', "\u{66}\u{66}\u{6c}"),
    ('\u{fb05}', "\u{73}\u{74}"),
    ('\u{fb06}', "\u{73}\u{74}"),
    ('\u{fb13}', "\u{574}\u{576}"),
    ('\u{fb14}', "\u{574}\u{565}"),
    ('\u{fb15}', "\u{574}\u{56b}"),
    ('\u{fb16}', "\u{57e}\u{576}"),
    ('\u{fb17}', "\u{574}\u{56d}"),
];

/// Builds the registry's canonical case-insensitive provider-name key.
fn provider_name_casefold(name: &str) -> String {
    let mut folded = String::with_capacity(name.len());
    for character in name.chars() {
        match PROVIDER_NAME_CASEFOLD_EXCEPTIONS
            .binary_search_by_key(&character, |(code_point, _)| *code_point)
        {
            Ok(index) => folded.push_str(PROVIDER_NAME_CASEFOLD_EXCEPTIONS[index].1),
            Err(_) => folded.extend(character.to_lowercase()),
        }
    }
    folded
}

fn validate_bounded_text(value: &str, field: &str, max_chars: usize) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field}不能为空"));
    }
    if value != value.trim() {
        return Err(format!("{field}首尾不能包含空白"));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{field}不能超过 {max_chars} 个字符"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{field}不能包含控制字符"));
    }
    Ok(())
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_BASE_URL_BYTES {
        return Err("基础 URL 为空或过长".to_string());
    }
    let mut url = Url::parse(trimmed).map_err(|error| format!("基础 URL 无效：{error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("基础 URL 仅支持 http 或 https".to_string());
    }
    if url.host_str().is_none() {
        return Err("基础 URL 必须包含主机名".to_string());
    }
    let is_exact_loopback = match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address == std::net::Ipv4Addr::LOCALHOST,
        Some(url::Host::Ipv6(address)) => address == std::net::Ipv6Addr::LOCALHOST,
        None => false,
    };
    if url.scheme() == "http" && !is_exact_loopback {
        return Err("远程基础 URL 必须使用 https；http 仅允许本机回环地址".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("基础 URL 不能包含用户名或密码".to_string());
    }
    if url.query().is_some() {
        return Err("基础 URL 不能包含查询参数".to_string());
    }
    if url.fragment().is_some() {
        return Err("基础 URL 不能包含片段".to_string());
    }

    let normalized_path = url.path().trim_end_matches('/').to_string();
    url.set_path(&normalized_path);
    let mut normalized = url.to_string();
    if normalized_path.is_empty() {
        normalized.pop();
    }
    Ok(normalized)
}

fn is_local_base_url(value: &str) -> Result<bool, String> {
    let normalized = normalize_base_url(value)?;
    let url = Url::parse(&normalized).map_err(|error| format!("基础 URL 无效：{error}"))?;
    Ok(match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address == std::net::Ipv4Addr::LOCALHOST,
        Some(url::Host::Ipv6(address)) => address == std::net::Ipv6Addr::LOCALHOST,
        None => false,
    })
}

fn validate_timestamp(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_TIMESTAMP_BYTES || !is_rfc3339_timestamp(value) {
        return Err(format!("{field}必须是有效 ISO 8601 时间戳"));
    }
    Ok(())
}

fn is_rfc3339_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return false;
    }

    let number = |start: usize, end: usize| -> Option<u32> {
        std::str::from_utf8(bytes.get(start..end)?)
            .ok()?
            .parse()
            .ok()
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0, 4),
        number(5, 7),
        number(8, 10),
        number(11, 13),
        number(14, 16),
        number(17, 19),
    ) else {
        return false;
    };
    if year == 0 || !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        2 if leap_year => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if day == 0 || day > days_in_month {
        return false;
    }

    let mut position = 19;
    if bytes.get(position) == Some(&b'.') {
        position += 1;
        let fraction_start = position;
        while bytes.get(position).is_some_and(u8::is_ascii_digit) {
            position += 1;
        }
        if position == fraction_start {
            return false;
        }
    }
    if bytes.get(position) == Some(&b'Z') {
        return position + 1 == bytes.len();
    }
    if !matches!(bytes.get(position), Some(b'+') | Some(b'-'))
        || bytes.get(position + 3) != Some(&b':')
        || position + 6 != bytes.len()
    {
        return false;
    }
    let (Some(offset_hour), Some(offset_minute)) =
        (number(position + 1, position + 3), number(position + 4, position + 6))
    else {
        return false;
    };
    offset_hour <= 23 && offset_minute <= 59
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        fs,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Barrier, Mutex,
        },
        thread,
    };

    const VALID_TIMESTAMP: &str = "2026-08-17T08:30:45.123Z";

    fn case_paths(case_id: &str) -> (PathBuf, PathBuf, PathBuf) {
        let directory = std::env::temp_dir()
            .join("focus-ai-model-provider-tests")
            .join(case_id);
        fs::create_dir_all(&directory).expect("create isolated test directory");
        (
            directory.join("model-providers-v1.json"),
            directory.join("model-providers-recovery-v1.json"),
            directory.join("model-providers-v1.json.tmp"),
        )
    }

    fn remove_test_file(path: &Path) {
        if path.is_file() {
            fs::remove_file(path).expect("remove explicit test file");
        }
    }

    fn cleanup(paths: &[&Path]) {
        for path in paths {
            remove_test_file(path);
        }
    }

    fn profile(index: usize, name: &str, base_url: &str) -> ProviderProfile {
        ProviderProfile {
            id: format!("00000000-0000-4000-8000-{index:012}"),
            name: name.to_string(),
            base_url: base_url.to_string(),
            model_id: "MiniMax-M3".to_string(),
            credential_generation: 0,
            created_at: VALID_TIMESTAMP.to_string(),
            updated_at: VALID_TIMESTAMP.to_string(),
        }
    }

    fn registry(profiles: Vec<ProviderProfile>) -> ProviderRegistryV1 {
        ProviderRegistryV1 {
            version: REGISTRY_VERSION,
            profiles,
            pending_credential_deletes: Vec::new(),
        }
    }

    fn test_store(
        registry_path: PathBuf,
        recovery_path: PathBuf,
        publisher: Arc<dyn RegistryPublisher>,
        credentials: Arc<dyn ProviderCredentials>,
    ) -> ModelProviderStore {
        ModelProviderStore {
            registry_path,
            recovery_path,
            publisher,
            credentials,
            connection_test_queue: Arc::new(ConnectionTestQueue::default()),
        }
    }

    struct BackupCheckingPublisher {
        recovery_path: PathBuf,
        expected_recovery: Vec<u8>,
    }

    impl RegistryPublisher for BackupCheckingPublisher {
        fn publish(&self, temporary_path: &Path, registry_path: &Path) -> Result<(), String> {
            let recovered = fs::read(&self.recovery_path)
                .map_err(|error| format!("recovery was not published first: {error}"))?;
            if recovered != self.expected_recovery {
                return Err("recovery bytes changed before replacement".to_string());
            }
            NativeRegistryPublisher.publish(temporary_path, registry_path)
        }
    }

    struct FailingPublisher;

    impl RegistryPublisher for FailingPublisher {
        fn publish(&self, _temporary_path: &Path, _registry_path: &Path) -> Result<(), String> {
            Err("injected publisher failure".to_string())
        }
    }

    #[derive(Default)]
    struct InMemoryProviderCredentials {
        secrets: Mutex<HashMap<String, String>>,
    }

    impl ProviderCredentials for InMemoryProviderCredentials {
        fn exists(&self, profile_id: &str) -> Result<bool, String> {
            Ok(self.secrets.lock().unwrap().contains_key(profile_id))
        }

        fn read(&self, profile_id: &str) -> Result<Option<String>, String> {
            Ok(self.secrets.lock().unwrap().get(profile_id).cloned())
        }

        fn save(&self, profile_id: &str, secret: &str) -> Result<(), String> {
            self.secrets
                .lock()
                .unwrap()
                .insert(profile_id.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, profile_id: &str) -> Result<(), String> {
            self.secrets.lock().unwrap().remove(profile_id);
            Ok(())
        }
    }

    #[derive(Default)]
    struct UnavailableProviderCredentials {
        delete_calls: AtomicUsize,
    }

    impl ProviderCredentials for UnavailableProviderCredentials {
        fn exists(&self, _profile_id: &str) -> Result<bool, String> {
            Err("injected credential store outage".to_string())
        }

        fn read(&self, _profile_id: &str) -> Result<Option<String>, String> {
            Err("injected credential store outage".to_string())
        }

        fn save(&self, _profile_id: &str, _secret: &str) -> Result<(), String> {
            Err("injected credential store outage".to_string())
        }

        fn delete(&self, _profile_id: &str) -> Result<(), String> {
            self.delete_calls.fetch_add(1, Ordering::SeqCst);
            Err("injected credential store outage".to_string())
        }
    }

    struct TargetSentinelCredentials {
        values: Mutex<HashMap<String, String>>,
        calls: Mutex<Vec<String>>,
    }

    impl TargetSentinelCredentials {
        fn with_legacy_sentinels() -> Self {
            let mut values = HashMap::new();
            values.insert(
                crate::credential_store::legacy_minimax_credential_target().to_string(),
                "synthetic-legacy-minimax-key".to_string(),
            );
            values.insert(
                crate::region_store::legacy_minimax_region_target().to_string(),
                "global".to_string(),
            );
            Self {
                values: Mutex::new(values),
                calls: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }

        fn value(&self, target: &str) -> Option<String> {
            self.values.lock().unwrap().get(target).cloned()
        }
    }

    impl ProviderCredentials for TargetSentinelCredentials {
        fn exists(&self, profile_id: &str) -> Result<bool, String> {
            self.calls.lock().unwrap().push(profile_id.to_string());
            Ok(self.values.lock().unwrap().contains_key(profile_id))
        }

        fn read(&self, profile_id: &str) -> Result<Option<String>, String> {
            self.calls.lock().unwrap().push(profile_id.to_string());
            Ok(self.values.lock().unwrap().get(profile_id).cloned())
        }

        fn save(&self, profile_id: &str, secret: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(profile_id.to_string());
            self.values.lock().unwrap().insert(profile_id.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, profile_id: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(profile_id.to_string());
            self.values.lock().unwrap().remove(profile_id);
            Ok(())
        }
    }

    fn workspace_database_path(case_id: &str) -> PathBuf {
        let directory = std::env::temp_dir()
            .join("focus-ai-model-provider-tests")
            .join(case_id);
        fs::create_dir_all(&directory).expect("create isolated workspace test directory");
        directory.join("focus-ai.db")
    }

    fn cleanup_workspace_database(database_path: &Path) {
        remove_test_file(database_path);
        remove_test_file(&database_path.with_file_name("focus-ai.db-wal"));
        remove_test_file(&database_path.with_file_name("focus-ai.db-shm"));
    }

    #[test]
    fn credential_lifecycle_uses_an_injected_profile_isolated_backend() {
        let (registry_path, recovery_path, temporary_path) = case_paths("credential-backend");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(InMemoryProviderCredentials::default());
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials,
        );
        let first = "550e8400-e29b-41d4-a716-446655440000";
        let second = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

        assert!(!store.credential_exists(first).unwrap());
        store
            .save_credential(first, "synthetic-test-secret")
            .unwrap();
        assert!(store.credential_exists(first).unwrap());
        assert!(!store.credential_exists(second).unwrap());
        store.delete_credential(first).unwrap();
        assert!(!store.credential_exists(first).unwrap());

        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn list_remains_authoritative_and_side_effect_free_during_a_credential_store_outage() {
        let (registry_path, recovery_path, temporary_path) = case_paths("credential-outage-list");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(UnavailableProviderCredentials::default());
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials.clone(),
        );
        let active = profile(1, "Still visible", "https://api.example.com/v1");
        let pending_id = "6ba7b810-9dad-11d1-80b4-00c04fd430c8".to_string();
        let mut stored = registry(vec![active.clone()]);
        stored.pending_credential_deletes.push(pending_id.clone());
        store.publish(&stored).unwrap();

        let listed = store.list().unwrap();

        assert_eq!(listed.profiles.len(), 1);
        assert_eq!(listed.profiles[0].id, active.id);
        assert!(!listed.profiles[0].has_credential);
        assert_eq!(listed.pending_credential_deletes, [pending_id]);
        assert_eq!(credentials.delete_calls.load(Ordering::SeqCst), 0);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn workspace_clear_keeps_the_actual_provider_registry_byte_exact() {
        let (registry_path, recovery_path, temporary_path) = case_paths("workspace-clear-registry-isolation");
        let database_path = workspace_database_path("workspace-clear-registry-isolation");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        cleanup_workspace_database(&database_path);
        let provider_store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );
        let provider = provider_store
            .create(
                create_input("Workspace sentinel", "http://127.0.0.1:11434/v1", None),
                VALID_TIMESTAMP,
            )
            .unwrap();
        let registry_before = fs::read(&registry_path).unwrap();
        let workspace = crate::workspace_store::WorkspaceStore::for_test_database(database_path.clone()).unwrap();
        workspace
            .save_document(r#"{"version":3,"projects":[],"milestones":[],"tasks":[{"title":"clear me"}],"quarterGoals":[]}"#)
            .unwrap();

        workspace
            .save_document(r#"{"version":3,"projects":[],"milestones":[],"tasks":[],"quarterGoals":[]}"#)
            .unwrap();

        assert_eq!(workspace.load_document().unwrap().as_deref(), Some(r#"{"version":3,"projects":[],"milestones":[],"tasks":[],"quarterGoals":[]}"#));
        assert_eq!(fs::read(&registry_path).unwrap(), registry_before);
        assert_eq!(provider_store.list().unwrap().profiles.len(), 1);
        assert_eq!(provider_store.list().unwrap().profiles[0].id, provider.id);
        cleanup_workspace_database(&database_path);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn custom_provider_crud_preserves_exact_legacy_minimax_credential_and_region_targets() {
        let (registry_path, recovery_path, temporary_path) = case_paths("legacy-minimax-target-preservation");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(TargetSentinelCredentials::with_legacy_sentinels());
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials.clone(),
        );
        let legacy_credential_target = crate::credential_store::legacy_minimax_credential_target();
        let legacy_region_target = crate::region_store::legacy_minimax_region_target();
        let provider = store
            .create(
                create_input("Custom", "https://api.example.com/v1", Some("synthetic-custom-key-one")),
                VALID_TIMESTAMP,
            )
            .unwrap();
        store
            .update(
                &provider.id,
                UpdateProviderInput {
                    name: "Custom updated".to_string(),
                    base_url: "https://api.example.com/v1".to_string(),
                    model_id: "MiniMax-M3".to_string(),
                },
                "2026-08-17T08:31:00.000Z",
            )
            .unwrap();
        store
            .replace_api_key(
                &provider.id,
                "synthetic-custom-key-two".to_string(),
            )
            .unwrap();
        store.delete(&provider.id).unwrap();

        assert_eq!(credentials.value(legacy_credential_target).as_deref(), Some("synthetic-legacy-minimax-key"));
        assert_eq!(credentials.value(legacy_region_target).as_deref(), Some("global"));
        let calls = credentials.calls();
        assert!(!calls.is_empty());
        for profile_id in calls {
            assert!(Uuid::parse_str(&profile_id).is_ok());
            let custom_target = crate::provider_credential_store::credential_target(&profile_id).unwrap();
            assert_ne!(custom_target, legacy_credential_target);
            assert_ne!(custom_target, legacy_region_target);
        }
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    struct InterleavingPublisher {
        barrier: Barrier,
        temporary_paths: Mutex<Vec<PathBuf>>,
    }

    struct LifecycleCredentials {
        secrets: Mutex<HashMap<String, String>>,
        fail_save: Mutex<bool>,
        fail_delete: Mutex<bool>,
        events: Arc<Mutex<Vec<String>>>,
    }

    impl LifecycleCredentials {
        fn new(events: Arc<Mutex<Vec<String>>>) -> Self {
            Self {
                secrets: Mutex::new(HashMap::new()),
                fail_save: Mutex::new(false),
                fail_delete: Mutex::new(false),
                events,
            }
        }
    }

    impl ProviderCredentials for LifecycleCredentials {
        fn exists(&self, profile_id: &str) -> Result<bool, String> {
            Ok(self.secrets.lock().unwrap().contains_key(profile_id))
        }

        fn read(&self, profile_id: &str) -> Result<Option<String>, String> {
            Ok(self.secrets.lock().unwrap().get(profile_id).cloned())
        }

        fn save(&self, profile_id: &str, secret: &str) -> Result<(), String> {
            if *self.fail_save.lock().unwrap() {
                return Err("injected credential save failure".to_string());
            }
            self.secrets
                .lock()
                .unwrap()
                .insert(profile_id.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, profile_id: &str) -> Result<(), String> {
            self.events.lock().unwrap().push("secret-delete".to_string());
            if *self.fail_delete.lock().unwrap() {
                return Err("injected credential delete failure".to_string());
            }
            self.secrets.lock().unwrap().remove(profile_id);
            Ok(())
        }
    }

    struct RecordingPublisher {
        events: Arc<Mutex<Vec<String>>>,
    }

    impl RegistryPublisher for RecordingPublisher {
        fn publish(&self, temporary_path: &Path, registry_path: &Path) -> Result<(), String> {
            self.events.lock().unwrap().push("registry-publish".to_string());
            NativeRegistryPublisher.publish(temporary_path, registry_path)
        }
    }

    struct FailOncePublisher {
        failed: Mutex<bool>,
    }

    impl RegistryPublisher for FailOncePublisher {
        fn publish(&self, temporary_path: &Path, registry_path: &Path) -> Result<(), String> {
            let mut failed = self.failed.lock().unwrap();
            if !*failed {
                *failed = true;
                return Err("injected lifecycle publish failure".to_string());
            }
            NativeRegistryPublisher.publish(temporary_path, registry_path)
        }
    }

    fn create_input(name: &str, base_url: &str, api_key: Option<&str>) -> CreateProviderInput {
        CreateProviderInput {
            name: name.to_string(),
            base_url: base_url.to_string(),
            model_id: "MiniMax-M3".to_string(),
            api_key: api_key.map(str::to_string),
        }
    }

    #[test]
    fn remote_create_publishes_missing_key_profile_then_can_rekey() {
        let (registry_path, recovery_path, temporary_path) = case_paths("remote-create-rekey");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(InMemoryProviderCredentials::default());
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials,
        );

        let created = store
            .create(
                create_input("Remote", "https://api.example.com/v1", None),
                VALID_TIMESTAMP,
            )
            .unwrap();
        assert_eq!(created.credential_generation, 0);
        assert!(!created.has_credential);
        assert!(!created.is_local);
        assert_eq!(store.list().unwrap().profiles.len(), 1);

        let rekeyed = store
            .replace_api_key(
                &created.id,
                "synthetic-test-secret".to_string(),
            )
            .unwrap();
        assert_eq!(rekeyed.credential_generation, 1);
        assert!(rekeyed.has_credential);
        assert!(!rekeyed.is_local);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn create_credential_failure_keeps_the_committed_profile_authoritative() {
        let (registry_path, recovery_path, temporary_path) = case_paths("create-partial-commit");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(LifecycleCredentials::new(Arc::new(Mutex::new(Vec::new()))));
        *credentials.fail_save.lock().unwrap() = true;
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials.clone(),
        );

        let error = store.create(
            create_input("Committed remote", "https://api.example.com/v1", Some("synthetic-test-secret")),
            VALID_TIMESTAMP,
        ).unwrap_err();

        assert!(error.contains("credential save failure"));
        let list = store.list().unwrap();
        assert_eq!(list.profiles.len(), 1);
        assert_eq!(list.profiles[0].name, "Committed remote");
        assert!(!list.profiles[0].has_credential);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn rekey_publish_failure_keeps_the_previous_credential_and_generation() {
        let (registry_path, recovery_path, temporary_path) = case_paths("rekey-publish-failure");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(InMemoryProviderCredentials::default());
        let stable_store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials.clone(),
        );
        let created = stable_store
            .create(
                create_input(
                    "Stable remote",
                    "https://api.example.com/v1",
                    Some("synthetic-old-secret"),
                ),
                VALID_TIMESTAMP,
            )
            .unwrap();
        let failing_store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(FailingPublisher),
            credentials.clone(),
        );

        let error = failing_store
            .replace_api_key(&created.id, "synthetic-new-secret".to_string())
            .unwrap_err();

        assert!(error.contains("publisher failure"));
        assert_eq!(
            credentials.read(&created.id).unwrap().as_deref(),
            Some("synthetic-old-secret")
        );
        assert_eq!(stable_store.load().unwrap().profiles[0].credential_generation, 0);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn rekey_never_changes_metadata_updated_at_on_success_or_failure() {
        let (registry_path, recovery_path, temporary_path) = case_paths("rekey-metadata-stability");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(LifecycleCredentials::new(Arc::new(Mutex::new(Vec::new()))));
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials.clone(),
        );
        let created = store.create(
            create_input("Stable metadata", "https://api.example.com/v1", Some("synthetic-first-secret")),
            VALID_TIMESTAMP,
        ).unwrap();

        let rekeyed = store.replace_api_key(
            &created.id,
            "synthetic-second-secret".to_string(),
        ).unwrap();
        assert_eq!(rekeyed.updated_at, VALID_TIMESTAMP);

        *credentials.fail_save.lock().unwrap() = true;
        assert!(store.replace_api_key(
            &created.id,
            "synthetic-third-secret".to_string(),
        ).is_err());
        assert_eq!(store.list().unwrap().profiles[0].updated_at, VALID_TIMESTAMP);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn provider_listing_and_registry_export_never_serialize_the_credential() {
        let (registry_path, recovery_path, temporary_path) = case_paths("credential-absent-from-export");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );

        let profile = store
            .create(
                create_input(
                    "Export-safe remote",
                    "https://api.example.com/v1",
                    Some("synthetic-provider-export-secret"),
                ),
                VALID_TIMESTAMP,
            )
            .unwrap();
        let list = serde_json::to_string(&store.list().unwrap()).unwrap();
        let registry = fs::read_to_string(&registry_path).unwrap();

        assert!(list.contains(&profile.id));
        assert!(registry.contains(&profile.id));
        for serialized in [&list, &registry] {
            assert!(!serialized.contains("synthetic-provider-export-secret"));
            assert!(!serialized.contains("apiKey"));
            assert!(!serialized.contains("authorization"));
        }
        assert!(list.contains("credentialGeneration"));
        assert!(list.contains("hasCredential"));
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn localhost_profile_is_callable_without_a_key() {
        let (registry_path, recovery_path, temporary_path) = case_paths("localhost-no-key");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );

        let created = store
            .create(
                create_input("Local", "http://localhost:11434/v1", None),
                VALID_TIMESTAMP,
            )
            .unwrap();

        assert!(created.is_local);
        assert!(!created.has_credential);
        assert!(created.is_local || created.has_credential);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn delete_removes_profile_before_secret_and_persists_cleanup_on_failure() {
        let (registry_path, recovery_path, temporary_path) = case_paths("delete-order");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let events = Arc::new(Mutex::new(Vec::new()));
        let credentials = Arc::new(LifecycleCredentials::new(events.clone()));
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(RecordingPublisher { events: events.clone() }),
            credentials.clone(),
        );
        let created = store
            .create(
                create_input(
                    "Delete Me",
                    "https://api.example.com/v1",
                    Some("synthetic-test-secret"),
                ),
                VALID_TIMESTAMP,
            )
            .unwrap();
        events.lock().unwrap().clear();
        *credentials.fail_delete.lock().unwrap() = true;

        let error = store.delete(&created.id).unwrap_err();

        assert!(error.contains("credential delete failure"));
        assert_eq!(
            *events.lock().unwrap(),
            vec!["registry-publish", "secret-delete"]
        );
        let registry = store.load().unwrap();
        assert!(registry.profiles.is_empty());
        assert_eq!(registry.pending_credential_deletes, [created.id]);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn cleanup_retry_removes_tombstone_only_after_secret_delete() {
        let (registry_path, recovery_path, temporary_path) = case_paths("cleanup-retry");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let events = Arc::new(Mutex::new(Vec::new()));
        let credentials = Arc::new(LifecycleCredentials::new(events.clone()));
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(RecordingPublisher { events: events.clone() }),
            credentials.clone(),
        );
        let created = store
            .create(
                create_input(
                    "Retry Delete",
                    "https://api.example.com/v1",
                    Some("synthetic-test-secret"),
                ),
                VALID_TIMESTAMP,
            )
            .unwrap();
        *credentials.fail_delete.lock().unwrap() = true;
        assert!(store.delete(&created.id).is_err());
        events.lock().unwrap().clear();

        assert!(store.retry_credential_cleanup(&created.id).is_err());
        assert_eq!(*events.lock().unwrap(), vec!["secret-delete"]);
        assert_eq!(
            store.load().unwrap().pending_credential_deletes,
            [created.id.clone()]
        );

        *credentials.fail_delete.lock().unwrap() = false;
        events.lock().unwrap().clear();
        let result = store.retry_credential_cleanup(&created.id).unwrap();
        assert_eq!(
            *events.lock().unwrap(),
            vec!["secret-delete", "registry-publish"]
        );
        assert!(result.pending_credential_deletes.is_empty());
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn lifecycle_queue_recovers_after_a_failed_operation() {
        let (registry_path, recovery_path, temporary_path) = case_paths("queue-recovery");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        fs::write(&registry_path, serde_json::to_vec(&registry(Vec::new())).unwrap()).unwrap();
        let state = Mutex::new(test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(FailOncePublisher {
                failed: Mutex::new(false),
            }),
            Arc::new(InMemoryProviderCredentials::default()),
        ));

        let first = with_lifecycle_store(&state, |store| {
            store.create(
                create_input("First", "https://api.example.com/v1", None),
                VALID_TIMESTAMP,
            )
        });
        assert!(first.is_err());

        let second = with_lifecycle_store(&state, |store| {
            store.create(
                create_input("Second", "https://api.example.com/v1", None),
                "2026-08-17T08:32:00.000Z",
            )
        })
        .unwrap();
        assert_eq!(second.name, "Second");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn deferred_connection_test_gate_rejects_every_provider_mutation_and_releases_on_drop() {
        let (registry_path, recovery_path, temporary_path) = case_paths("connection-test-gate");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );
        let active = store.create(
            create_input("Active", "http://127.0.0.1:11434/v1", None),
            VALID_TIMESTAMP,
        ).unwrap();
        let pending_id = "6ba7b810-9dad-11d1-80b4-00c04fd430c8".to_string();
        let mut value = store.load().unwrap();
        value.pending_credential_deletes.push(pending_id.clone());
        store.publish(&value).unwrap();

        let permit = store.begin_connection_test(&active.id).unwrap();
        assert!(store.create(
            create_input("Blocked create", "http://127.0.0.1:11435/v1", None),
            "2026-08-17T09:00:00.000Z",
        ).unwrap_err().contains("测试连接"));
        assert!(store.update(&active.id, UpdateProviderInput {
            name: "Blocked update".to_string(),
            base_url: active.base_url.clone(),
            model_id: active.model_id.clone(),
        }, "2026-08-17T09:00:00.000Z").unwrap_err().contains("测试连接"));
        assert!(store.replace_api_key(
            &active.id,
            "synthetic-blocked-secret".to_string(),
        ).unwrap_err().contains("测试连接"));
        assert!(store.delete(&active.id).unwrap_err().contains("测试连接"));
        assert!(store.retry_credential_cleanup(&pending_id).unwrap_err().contains("测试连接"));

        drop(permit);
        let updated = store.update(&active.id, UpdateProviderInput {
            name: "Released update".to_string(),
            base_url: active.base_url,
            model_id: active.model_id,
        }, "2026-08-17T09:00:00.000Z").unwrap();
        assert_eq!(updated.name, "Released update");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn connection_test_operation_releases_the_gate_on_success_error_and_cancel() {
        use std::{
            future::Future,
            pin::Pin,
            task::{Context, Poll, Waker},
        };

        struct OneYield {
            yielded: bool,
            result: Option<Result<(), String>>,
        }

        impl Future for OneYield {
            type Output = Result<(), String>;

            fn poll(mut self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<Self::Output> {
                if !self.yielded {
                    self.yielded = true;
                    Poll::Pending
                }
                else {
                    Poll::Ready(self.result.take().unwrap())
                }
            }
        }

        let (registry_path, recovery_path, temporary_path) = case_paths("connection-test-outcomes");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );
        let active = store.create(
            create_input("Active", "http://127.0.0.1:11434/v1", None),
            VALID_TIMESTAMP,
        ).unwrap();
        let state = Mutex::new(store);
        let waker = Waker::noop();
        let mut context = Context::from_waker(waker);

        for outcome in [Ok(()), Err("synthetic connection error".to_string())] {
            let mut future = Box::pin(run_connection_test_with(
                &state,
                &active.id,
                |_| OneYield { yielded: false, result: Some(outcome) },
            ));
            assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
            assert!(with_lifecycle_store(&state, |store| store.ensure_mutation_allowed()).is_err());
            assert!(matches!(future.as_mut().poll(&mut context), Poll::Ready(_)));
            assert!(with_lifecycle_store(&state, |store| store.ensure_mutation_allowed()).is_ok());
        }

        let mut cancelled = Box::pin(run_connection_test_with(
            &state,
            &active.id,
            |_| OneYield { yielded: false, result: Some(Ok(())) },
        ));
        assert!(matches!(cancelled.as_mut().poll(&mut context), Poll::Pending));
        assert!(with_lifecycle_store(&state, |store| store.ensure_mutation_allowed()).is_err());
        drop(cancelled);
        assert!(with_lifecycle_store(&state, |store| store.ensure_mutation_allowed()).is_ok());

        let operation_calls = Arc::new(AtomicUsize::new(0));
        let first_calls = operation_calls.clone();
        let mut first = Box::pin(run_connection_test_with(
            &state,
            &active.id,
            move |_| {
                first_calls.fetch_add(1, Ordering::SeqCst);
                OneYield { yielded: false, result: Some(Ok(())) }
            },
        ));
        let second_calls = operation_calls.clone();
        let mut second = Box::pin(run_connection_test_with(
            &state,
            &active.id,
            move |_| {
                second_calls.fetch_add(1, Ordering::SeqCst);
                OneYield { yielded: false, result: Some(Ok(())) }
            },
        ));

        assert!(matches!(first.as_mut().poll(&mut context), Poll::Pending));
        assert_eq!(operation_calls.load(Ordering::SeqCst), 1);
        assert!(matches!(second.as_mut().poll(&mut context), Poll::Pending));
        assert_eq!(operation_calls.load(Ordering::SeqCst), 1);
        assert!(matches!(first.as_mut().poll(&mut context), Poll::Ready(Ok(()))));
        assert!(matches!(second.as_mut().poll(&mut context), Poll::Pending));
        assert_eq!(operation_calls.load(Ordering::SeqCst), 2);
        assert!(matches!(second.as_mut().poll(&mut context), Poll::Ready(Ok(()))));
        assert!(with_lifecycle_store(&state, |store| store.ensure_mutation_allowed()).is_ok());

        let mut active_with_cancelled_waiter = Box::pin(run_connection_test_with(
            &state,
            &active.id,
            |_| OneYield { yielded: false, result: Some(Ok(())) },
        ));
        let mut queued_then_cancelled = Box::pin(run_connection_test_with(
            &state,
            &active.id,
            |_| OneYield { yielded: false, result: Some(Ok(())) },
        ));
        assert!(matches!(
            active_with_cancelled_waiter.as_mut().poll(&mut context),
            Poll::Pending
        ));
        assert!(matches!(
            queued_then_cancelled.as_mut().poll(&mut context),
            Poll::Pending
        ));
        drop(queued_then_cancelled);
        assert!(matches!(
            active_with_cancelled_waiter.as_mut().poll(&mut context),
            Poll::Ready(Ok(()))
        ));
        assert!(with_lifecycle_store(&state, |store| store.ensure_mutation_allowed()).is_ok());

        let mut active_with_granted_waiter = Box::pin(run_connection_test_with(
            &state,
            &active.id,
            |_| OneYield { yielded: false, result: Some(Ok(())) },
        ));
        let mut granted_then_cancelled = Box::pin(run_connection_test_with(
            &state,
            &active.id,
            |_| OneYield { yielded: false, result: Some(Ok(())) },
        ));
        assert!(matches!(
            active_with_granted_waiter.as_mut().poll(&mut context),
            Poll::Pending
        ));
        assert!(matches!(
            granted_then_cancelled.as_mut().poll(&mut context),
            Poll::Pending
        ));
        assert!(matches!(
            active_with_granted_waiter.as_mut().poll(&mut context),
            Poll::Ready(Ok(()))
        ));
        drop(granted_then_cancelled);
        assert!(with_lifecycle_store(&state, |store| store.ensure_mutation_allowed()).is_ok());
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn legacy_registry_defaults_credential_generation_to_zero_and_rejects_unsafe_values() {
        let legacy = br#"{
            "version":1,
            "profiles":[{
                "id":"550e8400-e29b-41d4-a716-446655440000",
                "name":"Legacy provider",
                "baseUrl":"https://api.example.com/v1",
                "modelId":"legacy-model",
                "createdAt":"2026-08-17T08:30:45.123Z",
                "updatedAt":"2026-08-17T08:30:45.123Z"
            }],
            "pendingCredentialDeletes":[]
        }"#;
        let parsed = parse_registry(legacy).unwrap();
        assert_eq!(parsed.profiles[0].credential_generation, 0);

        let mut unsafe_registry = registry(vec![profile(
            1,
            "Unsafe generation",
            "https://api.example.com/v1",
        )]);
        unsafe_registry.profiles[0].credential_generation = 9_007_199_254_740_992;
        assert!(validate_registry(&unsafe_registry)
            .unwrap_err()
            .contains("安全整数"));
    }

    #[test]
    fn rekey_rejects_an_exhausted_generation_before_touching_the_credential_store() {
        let (registry_path, recovery_path, temporary_path) = case_paths("rekey-generation-overflow");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(InMemoryProviderCredentials::default());
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials.clone(),
        );
        let mut exhausted = profile(1, "Exhausted", "https://api.example.com/v1");
        exhausted.credential_generation = 9_007_199_254_740_991;
        store.publish(&registry(vec![exhausted.clone()])).unwrap();

        let error = store
            .replace_api_key(&exhausted.id, "synthetic-overflow-secret".to_string())
            .unwrap_err();

        assert!(error.contains("换钥次数"));
        assert!(!credentials.exists(&exhausted.id).unwrap());
        assert_eq!(
            store.load().unwrap().profiles[0].credential_generation,
            9_007_199_254_740_991
        );
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn owned_provider_secret_zeroes_direct_and_early_error_paths_without_native_credentials() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let zeroed = Arc::new(AtomicUsize::new(0));
        let observed = zeroed.clone();
        let observer: Arc<dyn Fn(&[u8]) + Send + Sync> = Arc::new(move |bytes| {
            assert!(bytes.iter().all(|byte| *byte == 0));
            observed.fetch_add(1, Ordering::SeqCst);
        });
        drop(OwnedProviderSecret::with_observer(
            "synthetic-direct-secret".to_string(),
            observer.clone(),
        ));

        let (registry_path, recovery_path, temporary_path) = case_paths("owned-secret-errors");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let credentials = Arc::new(LifecycleCredentials::new(Arc::new(Mutex::new(Vec::new()))));
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials.clone(),
        );
        {
            let mut secret = OwnedProviderSecret::with_observer(
                "synthetic-invalid-create-secret".to_string(),
                observer.clone(),
            );
            assert!(store.create_guarded(
                create_input("", "https://api.example.com/v1", None),
                Some(&mut secret),
                VALID_TIMESTAMP,
            ).is_err());
        }
        {
            let mut secret = OwnedProviderSecret::with_observer(
                "synthetic-invalid-rekey-secret".to_string(),
                observer.clone(),
            );
            assert!(store.replace_api_key_guarded("not-a-uuid", &mut secret).is_err());
        }
        let active = store.create(
            create_input("Active", "https://api.example.com/v1", None),
            VALID_TIMESTAMP,
        ).unwrap();
        *credentials.fail_save.lock().unwrap() = true;
        {
            let mut secret = OwnedProviderSecret::with_observer(
                "synthetic-save-failure-secret".to_string(),
                observer,
            );
            assert!(store.replace_api_key_guarded(&active.id, &mut secret).is_err());
        }

        assert_eq!(zeroed.load(Ordering::SeqCst), 4);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn startup_cleanup_does_not_publish_when_recoverable_credential_delete_fails() {
        let (registry_path, recovery_path, temporary_path) = case_paths("startup-recoverable-delete");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let pending_id = "550e8400-e29b-41d4-a716-446655440000";
        let mut value = registry(Vec::new());
        value.pending_credential_deletes.push(pending_id.to_string());
        fs::write(&registry_path, serde_json::to_vec(&value).unwrap()).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let credentials = Arc::new(LifecycleCredentials::new(events));
        *credentials.fail_delete.lock().unwrap() = true;
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(FailingPublisher),
            credentials,
        );

        store.retry_pending_credential_cleanup().unwrap();

        assert_eq!(store.load().unwrap().pending_credential_deletes, [pending_id]);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    impl RegistryPublisher for InterleavingPublisher {
        fn publish(&self, temporary_path: &Path, _registry_path: &Path) -> Result<(), String> {
            self.temporary_paths
                .lock()
                .unwrap()
                .push(temporary_path.to_path_buf());
            self.barrier.wait();
            Err("injected interleaved publisher failure".to_string())
        }
    }

    #[test]
    fn publish_normalizes_the_profile_base_url_before_writing() {
        let (registry_path, recovery_path, temporary_path) = case_paths("publish-normalizes-url");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );
        let value = registry(vec![profile(
            1,
            "Normalized",
            "  HTTPS://API.Example.COM/v1///  ",
        )]);

        store.publish(&value).unwrap();

        let written: ProviderRegistryV1 =
            serde_json::from_slice(&fs::read(&registry_path).unwrap()).unwrap();
        assert_eq!(written.profiles[0].base_url, "https://api.example.com/v1");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn rejects_duplicate_names_case_insensitively_and_more_than_twenty_profiles() {
        let duplicate_names = registry(vec![
            profile(1, "MiniMax Primary", "https://api.minimax.io/v1"),
            profile(2, "minimax primary", "https://api.example.com/v1"),
        ]);
        assert!(validate_registry(&duplicate_names)
            .unwrap_err()
            .contains("名称"));

        let too_many = registry(
            (0..=MAX_PROFILES)
                .map(|index| {
                    profile(
                        index,
                        &format!("Provider {index}"),
                        "https://api.example.com/v1",
                    )
                })
                .collect(),
        );
        assert!(validate_registry(&too_many)
            .unwrap_err()
            .contains("20"));
    }

    #[test]
    fn unicode_uppercase_expansion_detects_duplicate_names_and_keeps_chinese_names() {
        let german_equivalent = registry(vec![
            profile(1, "Straße", "https://api.example.com/v1"),
            profile(2, "STRASSE", "https://api.example.com/v1"),
        ]);
        assert!(validate_registry(&german_equivalent)
            .unwrap_err()
            .contains("名称"));

        let distinct_chinese = registry(vec![
            profile(1, "本地模型", "https://api.example.com/v1"),
            profile(2, "远程模型", "https://api.example.com/v1"),
        ]);
        assert!(validate_registry(&distinct_chinese).is_ok());
    }

    #[test]
    fn unicode_case_key_equates_dotted_i_and_sigma_variants() {
        for (first_name, second_name) in [("\u{130}", "i\u{307}"), ("\u{3a3}", "\u{3c2}")] {
            let equivalent = registry(vec![
                profile(1, first_name, "https://api.example.com/v1"),
                profile(2, second_name, "https://api.example.com/v1"),
            ]);
            assert!(
                validate_registry(&equivalent)
                    .unwrap_err()
                    .contains("名称"),
                "{first_name:?} and {second_name:?} must share the canonical name key"
            );
        }
    }

    #[test]
    fn full_casefold_equates_capital_sharp_s_with_ss() {
        let equivalent = registry(vec![
            profile(1, "\u{1e9e}", "https://api.example.com/v1"),
            profile(2, "SS", "https://api.example.com/v1"),
        ]);

        assert!(validate_registry(&equivalent)
            .unwrap_err()
            .contains("名称"));
    }

    #[test]
    fn full_casefold_keeps_dotless_i_distinct_from_i() {
        let distinct = registry(vec![
            profile(1, "\u{131}", "https://api.example.com/v1"),
            profile(2, "i", "https://api.example.com/v1"),
        ]);

        assert!(validate_registry(&distinct).is_ok());
    }

    #[test]
    fn full_casefold_handles_ligature_kelvin_and_long_s_representatives() {
        for (first_name, second_name) in [
            ("\u{fb03}", "ffi"),
            ("\u{212a}", "k"),
            ("\u{17f}", "s"),
        ] {
            let equivalent = registry(vec![
                profile(1, first_name, "https://api.example.com/v1"),
                profile(2, second_name, "https://api.example.com/v1"),
            ]);
            assert!(
                validate_registry(&equivalent)
                    .unwrap_err()
                    .contains("名称"),
                "{first_name:?} and {second_name:?} must share the casefold key"
            );
        }
    }

    #[test]
    fn casefold_exception_table_has_expected_count_and_strict_order() {
        assert_eq!(PROVIDER_NAME_CASEFOLD_EXCEPTIONS.len(), 297);
        assert!(PROVIDER_NAME_CASEFOLD_EXCEPTIONS
            .windows(2)
            .all(|pair| pair[0].0 < pair[1].0));
    }

    #[test]
    fn normalizes_base_url_and_rejects_credentials_query_and_fragment() {
        assert_eq!(
            normalize_base_url("  HTTPS://API.Example.COM/v1///  ").unwrap(),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_base_url("https://api.example.com/").unwrap(),
            "https://api.example.com"
        );

        for invalid in [
            "https://user:secret@api.example.com/v1",
            "https://api.example.com/v1?debug=true",
            "https://api.example.com/v1#models",
        ] {
            assert!(
                normalize_base_url(invalid).is_err(),
                "{invalid} must be rejected"
            );
        }
    }

    #[test]
    fn requires_https_except_for_exact_loopback_hosts() {
        for accepted in [
            "https://api.example.com/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1:8080/v1",
            "http://[::1]:8080/v1",
        ] {
            assert!(
                normalize_base_url(accepted).is_ok(),
                "{accepted} must be accepted"
            );
        }

        for rejected in [
            "http://api.example.com/v1",
            "http://localhost.example.com/v1",
            "http://127.0.0.2/v1",
            "http://[::2]/v1",
        ] {
            assert!(
                normalize_base_url(rejected).is_err(),
                "{rejected} must be rejected"
            );
        }
    }

    #[test]
    fn rejects_noncanonical_stored_profile_and_pending_ids() {
        for noncanonical in [
            "550E8400-E29B-41D4-A716-446655440000",
            "550e8400e29b41d4a716446655440000",
            "{550e8400-e29b-41d4-a716-446655440000}",
        ] {
            let mut active = profile(1, "Active", "https://api.example.com/v1");
            active.id = noncanonical.to_string();
            assert!(validate_registry(&registry(vec![active])).is_err(), "{noncanonical}");

            let mut pending = registry(Vec::new());
            pending.pending_credential_deletes.push(noncanonical.to_string());
            assert!(validate_registry(&pending).is_err(), "{noncanonical}");
        }
    }

    #[test]
    fn pending_credential_deletes_are_bounded_and_canonically_unique() {
        let mut duplicate = registry(Vec::new());
        duplicate.pending_credential_deletes = vec![
            "6ba7b810-9dad-11d1-80b4-00c04fd430c8".to_string(),
            "6ba7b810-9dad-11d1-80b4-00c04fd430c8".to_string(),
        ];
        assert!(validate_registry(&duplicate)
            .unwrap_err()
            .contains("不能重复"));

        let mut too_many = registry(Vec::new());
        too_many.pending_credential_deletes = (0..=MAX_PROFILES)
            .map(|index| format!("00000000-0000-4000-8000-{index:012}"))
            .collect();
        assert!(validate_registry(&too_many).unwrap_err().contains("20"));
    }

    #[test]
    fn provider_name_and_model_limits_count_unicode_scalar_values() {
        let mut accepted = profile(1, &"中".repeat(34), "https://api.example.com/v1");
        accepted.model_id = "模".repeat(160);
        assert!(validate_registry(&registry(vec![accepted])).is_ok());

        let rejected_name = profile(1, &"a".repeat(41), "https://api.example.com/v1");
        assert!(validate_registry(&registry(vec![rejected_name])).is_err());

        let mut rejected_model = profile(1, "Model limit", "https://api.example.com/v1");
        rejected_model.model_id = "m".repeat(161);
        assert!(validate_registry(&registry(vec![rejected_model])).is_err());
    }

    #[test]
    fn corrupted_registry_is_backed_up_byte_exact_and_returns_an_explicit_error() {
        let (registry_path, recovery_path, temporary_path) = case_paths("corrupt-recovery");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let corrupt_bytes = b"{\"version\":1,not-json".to_vec();
        fs::write(&registry_path, &corrupt_bytes).unwrap();
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(BackupCheckingPublisher {
                recovery_path: recovery_path.clone(),
                expected_recovery: corrupt_bytes.clone(),
            }),
            Arc::new(InMemoryProviderCredentials::default()),
        );

        let error = store.load().unwrap_err();

        assert!(error.contains("已损坏") || error.contains("JSON 无效"));
        assert_eq!(fs::read(&recovery_path).unwrap(), corrupt_bytes);
        assert_eq!(fs::read(&registry_path).unwrap(), corrupt_bytes);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn desktop_initialization_never_loads_registry_or_runs_credential_cleanup() {
        let source = include_str!("model_provider.rs");
        let start = source.find("pub fn initialize(app: &AppHandle)").unwrap();
        let end = source[start..].find("fn begin_connection_test").unwrap() + start;
        let initialize = &source[start..end];

        assert!(!initialize.contains(".load("));
        assert!(!initialize.contains("retry_pending_credential_cleanup"));
        assert!(!initialize.contains("parse_registry"));
    }

    #[test]
    fn failed_atomic_publish_preserves_the_previous_registry() {
        let (registry_path, recovery_path, temporary_path) = case_paths("publish-failure");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let old_bytes = serde_json::to_vec(&registry(vec![profile(
            1,
            "Existing",
            "https://api.example.com/v1",
        )]))
        .unwrap();
        fs::write(&registry_path, &old_bytes).unwrap();
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(FailingPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );
        let replacement = registry(vec![profile(
            2,
            "Replacement",
            "https://api.example.com/v1",
        )]);

        assert!(store
            .publish(&replacement)
            .unwrap_err()
            .contains("injected publisher failure"));
        assert_eq!(fs::read(&registry_path).unwrap(), old_bytes);
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn concurrent_publishes_use_distinct_sibling_temporary_files() {
        let (registry_path, recovery_path, temporary_path) = case_paths("concurrent-publish");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let publisher = Arc::new(InterleavingPublisher {
            barrier: Barrier::new(2),
            temporary_paths: Mutex::new(Vec::new()),
        });
        let store = Arc::new(test_store(
            registry_path.clone(),
            recovery_path.clone(),
            publisher.clone(),
            Arc::new(InMemoryProviderCredentials::default()),
        ));

        let handles: Vec<_> = (1..=2)
            .map(|index| {
                let store = store.clone();
                thread::spawn(move || {
                    store.publish(&registry(vec![profile(
                        index,
                        &format!("Concurrent {index}"),
                        "https://api.example.com/v1",
                    )]))
                })
            })
            .collect();
        for handle in handles {
            assert!(handle.join().unwrap().is_err());
        }

        let paths = publisher.temporary_paths.lock().unwrap().clone();
        assert_eq!(paths.len(), 2);
        assert_ne!(paths[0], paths[1]);
        for path in &paths {
            assert_eq!(path.parent(), registry_path.parent());
            assert!(!path.exists(), "failed publish must clean its own temp file");
        }
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn failed_recovery_backup_leaves_corrupted_registry_untouched() {
        let (registry_path, recovery_path, temporary_path) = case_paths("backup-failure");
        let blocker_path = recovery_path.with_file_name("recovery-parent-blocker");
        cleanup(&[
            &registry_path,
            &recovery_path,
            &temporary_path,
            &blocker_path,
        ]);
        let corrupt_bytes = b"not-json".to_vec();
        fs::write(&registry_path, &corrupt_bytes).unwrap();
        fs::write(&blocker_path, b"not a directory").unwrap();
        let store = test_store(
            registry_path.clone(),
            blocker_path.join("model-providers-recovery-v1.json"),
            Arc::new(FailingPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );

        let error = store.load().unwrap_err();

        assert!(error.contains("恢复备份"));
        assert_eq!(fs::read(&registry_path).unwrap(), corrupt_bytes);
        cleanup(&[
            &registry_path,
            &recovery_path,
            &temporary_path,
            &blocker_path,
        ]);
    }

    #[test]
    fn ai_profile_resolution_fails_for_unknown_deleted_or_remote_without_key() {
        let (registry_path, recovery_path, temporary_path) = case_paths("ai-resolution-failures");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let remote = profile(1, "Remote", "https://api.example.com/v1");
        fs::write(
            &registry_path,
            serde_json::to_vec(&registry(vec![remote.clone()])).unwrap(),
        )
        .unwrap();
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            Arc::new(InMemoryProviderCredentials::default()),
        );

        assert!(store
            .resolve_for_inference("not-a-uuid")
            .err()
            .unwrap()
            .contains("UUID"));
        assert!(store
            .resolve_for_inference("550e8400-e29b-41d4-a716-446655440000")
            .err()
            .unwrap()
            .contains("不存在"));
        assert!(store
            .resolve_for_inference(&remote.id)
            .err()
            .unwrap()
            .contains("API Key"));

        fs::write(&registry_path, serde_json::to_vec(&registry(Vec::new())).unwrap()).unwrap();
        assert!(store
            .resolve_for_inference(&remote.id)
            .err()
            .unwrap()
            .contains("不存在"));
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }

    #[test]
    fn ai_resolved_provider_never_derives_debug_over_the_credential_field() {
        let source = include_str!("model_provider.rs");
        let marker = source.find("pub(crate) struct ResolvedProvider").unwrap();
        let prefix = &source[marker.saturating_sub(80)..marker];

        assert!(!prefix.contains("derive(Debug)"));
    }

    #[test]
    fn ai_profile_resolution_allows_local_without_key_and_reads_remote_key() {
        let (registry_path, recovery_path, temporary_path) = case_paths("ai-resolution-success");
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
        let local = profile(1, "Local", "http://127.0.0.1:11434/v1");
        let remote = profile(2, "Remote", "https://api.example.com/v1");
        fs::write(
            &registry_path,
            serde_json::to_vec(&registry(vec![local.clone(), remote.clone()])).unwrap(),
        )
        .unwrap();
        let credentials = Arc::new(InMemoryProviderCredentials::default());
        credentials
            .save(&remote.id, "synthetic-test-secret")
            .unwrap();
        let store = test_store(
            registry_path.clone(),
            recovery_path.clone(),
            Arc::new(NativeRegistryPublisher),
            credentials,
        );

        let local_target = store.resolve_for_inference(&local.id).unwrap();
        assert_eq!(local_target.base_url, "http://127.0.0.1:11434/v1");
        assert!(local_target.api_key.is_none());
        let remote_target = store.resolve_for_inference(&remote.id).unwrap();
        assert_eq!(remote_target.model_id, "MiniMax-M3");
        assert_eq!(remote_target.api_key.as_deref(), Some("synthetic-test-secret"));
        cleanup(&[&registry_path, &recovery_path, &temporary_path]);
    }
}
