const CREDENTIAL_TARGET: &str = "com.focusai.taskmanager/minimax-api-key";

#[cfg(test)]
pub(crate) fn legacy_minimax_credential_target() -> &'static str {
    CREDENTIAL_TARGET
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{ffi::c_void, ptr};

    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW,
            CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        },
    };

    use super::{validate_api_key, CREDENTIAL_TARGET};

    pub fn exists() -> Result<bool, String> {
        match read()? {
            Some(secret) => {
                let mut bytes = secret.into_bytes();
                bytes.fill(0);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    pub fn read() -> Result<Option<String>, String> {
        let target = wide(CREDENTIAL_TARGET);
        let mut credential_ptr: *mut CREDENTIALW = ptr::null_mut();
        let ok = unsafe {
            CredReadW(
                target.as_ptr(),
                CRED_TYPE_GENERIC,
                0,
                &mut credential_ptr,
            )
        };

        if ok == 0 {
            let error = unsafe { GetLastError() };
            if error == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(format!("读取 Windows 凭据失败（错误 {error}）"));
        }

        if credential_ptr.is_null() {
            return Err("Windows 凭据返回了空记录".to_string());
        }

        let blob = unsafe {
            let credential = &*credential_ptr;
            if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                )
                .to_vec()
            }
        };
        unsafe { scrub_credential_and_free(credential_ptr) };

        if blob.is_empty() {
            return Ok(None);
        }
        String::from_utf8(blob)
            .map(Some)
            .map_err(|_| "Windows 凭据中的 MiniMax API Key 已损坏".to_string())
    }

    pub fn save(api_key: String) -> Result<(), String> {
        let normalized = api_key.trim().to_string();
        validate_api_key(&normalized)?;

        let mut target = wide(CREDENTIAL_TARGET);
        let mut username = wide("MiniMax API");
        let mut blob = normalized.into_bytes();
        let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target.as_mut_ptr();
        credential.CredentialBlobSize = blob.len() as u32;
        credential.CredentialBlob = blob.as_mut_ptr();
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        credential.UserName = username.as_mut_ptr();

        let ok = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        if ok == 0 {
            let error = unsafe { GetLastError() };
            return Err(format!("保存 Windows 凭据失败（错误 {error}）"));
        }
        Ok(())
    }

    pub fn delete() -> Result<(), String> {
        let target = wide(CREDENTIAL_TARGET);
        let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok == 0 {
            let error = unsafe { GetLastError() };
            if error != ERROR_NOT_FOUND {
                return Err(format!("删除 Windows 凭据失败（错误 {error}）"));
            }
        }
        Ok(())
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn scrub_credential_and_free(credential_ptr: *mut CREDENTIALW) {
        if credential_ptr.is_null() {
            return;
        }
        let credential = unsafe { &mut *credential_ptr };
        if !credential.CredentialBlob.is_null() {
            for index in 0..credential.CredentialBlobSize as usize {
                unsafe { std::ptr::write_volatile(credential.CredentialBlob.add(index), 0) };
            }
            std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
        }
        unsafe { CredFree(credential_ptr.cast::<c_void>()) };
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn exists() -> Result<bool, String> {
        Ok(false)
    }

    pub fn read() -> Result<Option<String>, String> {
        Err("当前系统不支持 Windows 凭据管理器".to_string())
    }

    pub fn save(_api_key: String) -> Result<(), String> {
        Err("当前系统不支持 Windows 凭据管理器".to_string())
    }

    pub fn delete() -> Result<(), String> {
        Err("当前系统不支持 Windows 凭据管理器".to_string())
    }
}

pub use platform::{delete, exists, read, save};

fn validate_api_key(api_key: &str) -> Result<(), String> {
    if api_key.len() < 16 || api_key.len() > 2048 {
        return Err("API Key 格式不正确".to_string());
    }
    if api_key.chars().any(char::is_whitespace) {
        return Err("API Key 不能包含空白字符".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_short_or_whitespace_credentials_without_touching_windows_store() {
        assert!(validate_api_key("short").is_err());
        assert!(validate_api_key("abcdefghijkl mnop").is_err());
        assert!(validate_api_key("abcdefghijklmnop").is_ok());
    }

    #[test]
    fn credential_target_is_namespaced_to_the_desktop_app() {
        assert_eq!(CREDENTIAL_TARGET, "com.focusai.taskmanager/minimax-api-key");
    }

    #[test]
    fn native_read_scrubs_the_credential_blob_before_cred_free() {
        let source = include_str!("credential_store.rs");
        let platform = source.split("#[cfg(target_os = \"windows\")]").nth(1).unwrap();
        let scrub_start = platform.find("unsafe fn scrub_credential_and_free").unwrap();
        let scrub = &platform[scrub_start..];

        assert!(platform.contains("scrub_credential_and_free(credential_ptr)"));
        assert!(scrub.contains("write_volatile"));
        assert!(scrub.find("write_volatile").unwrap() < scrub.find("CredFree").unwrap());
    }
}
