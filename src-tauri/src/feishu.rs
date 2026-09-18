use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::Mutex, time::Duration};
use url::Url;

const API: &str = "https://open.feishu.cn/open-apis";
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    app_id: String,
    app_secret: String,
    url: String,
}

impl Drop for Config {
    fn drop(&mut self) {
        let mut secret = std::mem::take(&mut self.app_secret).into_bytes();
        secret.fill(0);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { configured: bool, app_id: String, url: String }

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 200 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn parse_link(value: &str) -> Result<(String, String), String> {
    if value.len() > 1024 { return Err("飞书链接过长".into()); }
    let url = Url::parse(value).map_err(|_| "请输入有效飞书链接")?;
    let host = url.host_str().unwrap_or("");
    if url.scheme() != "https" || !(host == "feishu.cn" || host.ends_with(".feishu.cn"))
        || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err("仅支持无账号凭据的 HTTPS 飞书中国版链接".into());
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if parts.len() != 2 || !matches!(parts[0], "base" | "wiki") || !valid_id(parts[1]) {
        return Err("请使用 /base/ 或 /wiki/ 多维表格链接".into());
    }
    Ok((parts[0].into(), parts[1].into()))
}

fn validate(config: &Config) -> Result<(), String> {
    if !config.app_id.starts_with("cli_") || !valid_id(&config.app_id) { return Err("App ID 格式不正确".into()); }
    if config.app_secret.is_empty() || config.app_secret.len() > 512
        || config.app_secret.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("App Secret 不能为空、过长或包含空白".into());
    }
    parse_link(&config.url)?;
    Ok(())
}

fn load() -> Result<Option<Config>, String> {
    let _lock = CONFIG_LOCK.lock().map_err(|_| "飞书配置暂不可用")?;
    let Some(mut blob) = crate::provider_credential_store::read_feishu_config()? else { return Ok(None) };
    let result = serde_json::from_slice::<Config>(&blob).map_err(|_| "飞书配置已损坏，请重新保存".to_string());
    blob.fill(0);
    let config = result?;
    validate(&config)?;
    Ok(Some(config))
}

fn status(config: Option<&Config>) -> Status {
    Status { configured: config.is_some(), app_id: config.map_or(String::new(), |c| c.app_id.clone()), url: config.map_or(String::new(), |c| c.url.clone()) }
}

#[tauri::command]
pub fn feishu_get_status() -> Result<Status, String> { Ok(status(load()?.as_ref())) }

#[tauri::command]
pub fn feishu_save_config(mut input: Config) -> Result<Status, String> {
    input.app_id = input.app_id.trim().to_string();
    input.url = input.url.trim().to_string();
    // Blank secret means retain it, but never carry a secret to a different application.
    if input.app_secret.is_empty() {
        let saved = load()?.ok_or("首次配置请填写 App Secret")?;
        if saved.app_id != input.app_id { return Err("更换 App ID 时必须重新填写 App Secret".into()); }
        input.app_secret = saved.app_secret.clone();
    }
    validate(&input)?;
    let blob = serde_json::to_vec(&input).map_err(|_| "飞书配置编码失败")?;
    let _lock = CONFIG_LOCK.lock().map_err(|_| "飞书配置暂不可用")?;
    crate::provider_credential_store::save_feishu_config(blob)?;
    Ok(status(Some(&input)))
}

fn client() -> Result<Client, String> {
    Client::builder().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(25)).connect_timeout(Duration::from_secs(10))
        .build().map_err(|_| "无法初始化飞书连接".into())
}

fn check_response(value: Value) -> Result<Value, String> {
    match value.get("code").and_then(Value::as_i64) {
        Some(0) => Ok(value),
        Some(code) => Err(format!("飞书拒绝请求（错误码 {code}）。请检查凭据、已发布的应用权限及测试表可编辑授权；知识库链接还需节点读取权限。")),
        None => Err("飞书返回的数据格式不正确".into()),
    }
}

async fn request(builder: RequestBuilder) -> Result<Value, String> {
    let mut response = builder.send().await.map_err(|_| "飞书网络连接失败或超时，请检查网络后重试")?;
    if !response.status().is_success() { return Err(format!("飞书 HTTP {}，请检查网络和应用权限", response.status().as_u16())); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取飞书响应失败")? {
        if bytes.len() + chunk.len() > 2_000_000 { return Err("飞书响应过大，已停止读取".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let parsed = serde_json::from_slice(&bytes).map_err(|_| "飞书响应不是有效 JSON".to_string());
    bytes.fill(0);
    check_response(parsed?)
}

fn id_at(value: &Value, pointer: &str) -> Result<String, String> {
    let id = value.pointer(pointer).and_then(Value::as_str).filter(|s| valid_id(s)).ok_or("飞书响应缺少有效标识")?;
    Ok(id.to_string())
}

struct Session { client: Client, token: String, base: String }
impl Drop for Session {
    fn drop(&mut self) { let mut token = std::mem::take(&mut self.token).into_bytes(); token.fill(0); }
}
impl Session {
    async fn connect() -> Result<Self, String> {
        let config = load()?.ok_or("请先保存飞书配置")?;
        let client = client()?;
        let mut auth = request(client.post(format!("{API}/auth/v3/tenant_access_token/internal"))
            .json(&json!({"app_id":config.app_id,"app_secret":config.app_secret}))).await?;
        let token = auth.get_mut("tenant_access_token").map(Value::take).and_then(|v| v.as_str().map(str::to_owned))
            .filter(|s| !s.is_empty() && s.len() < 4096).ok_or("飞书未返回访问令牌")?;
        let (kind, id) = parse_link(&config.url)?;
        let mut session = Self { client, token, base: id.clone() };
        if kind == "wiki" {
            let node = session.get(&format!("/wiki/v2/spaces/get_node?token={id}")).await?;
            if node.pointer("/data/node/obj_type").and_then(Value::as_str) != Some("bitable") {
                return Err("该知识库节点不是多维表格，请更换链接".into());
            }
            session.base = id_at(&node, "/data/node/obj_token")?;
        }
        Ok(session)
    }
    async fn get(&self, path: &str) -> Result<Value, String> {
        request(self.client.get(format!("{API}{path}")).bearer_auth(&self.token)).await
    }
}

#[derive(Serialize, Deserialize)]
pub struct Table { table_id: String, name: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe { tables: Vec<Table>, has_more: bool }

#[tauri::command]
pub async fn feishu_test_connection() -> Result<Probe, String> {
    let session = Session::connect().await?;
    let result = session.get(&format!("/bitable/v1/apps/{}/tables?page_size=100", session.base)).await?;
    let tables: Vec<Table> = serde_json::from_value(result.pointer("/data/items").cloned().ok_or("飞书未返回数据表列表")?)
        .map_err(|_| "飞书数据表格式不正确")?;
    if tables.iter().any(|t| !valid_id(&t.table_id) || !t.table_id.starts_with("tbl")) { return Err("飞书数据表标识不正确".into()); }
    Ok(Probe { tables, has_more: result.pointer("/data/has_more").and_then(Value::as_bool).unwrap_or(false) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection { fields: Vec<String>, records_read: usize, has_more: bool }

#[tauri::command]
pub async fn feishu_inspect_table(table_id: String) -> Result<Inspection, String> {
    if !valid_id(&table_id) || !table_id.starts_with("tbl") { return Err("数据表 ID 格式不正确".into()); }
    let session = Session::connect().await?;
    let prefix = format!("/bitable/v1/apps/{}/tables/{table_id}", session.base);
    let fields = session.get(&format!("{prefix}/fields?page_size=100")).await?;
    let records = session.get(&format!("{prefix}/records?page_size=5")).await?;
    let field_items = fields.pointer("/data/items").and_then(Value::as_array).ok_or("飞书未返回字段列表")?;
    let names = field_items.iter().map(|f| f.get("field_name").and_then(Value::as_str).map(str::to_owned).ok_or("字段名称无效".to_string())).collect::<Result<Vec<_>, _>>()?;
    let items = records.pointer("/data/items").and_then(Value::as_array).ok_or("飞书未返回记录列表")?;
    // Do not return record content to the renderer or persist it in the local task database.
    Ok(Inspection { fields: names, records_read: items.len(), has_more: records.pointer("/data/has_more").and_then(Value::as_bool).unwrap_or(false) || fields.pointer("/data/has_more").and_then(Value::as_bool).unwrap_or(false) })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_base_and_wiki_but_never_arbitrary_hosts_or_paths() {
        assert_eq!(parse_link("https://example.feishu.cn/wiki/ABC123?from=copy").unwrap(), ("wiki".into(), "ABC123".into()));
        assert!(parse_link("https://example.feishu.cn/base/ABC123").is_ok());
        for link in ["http://example.feishu.cn/base/ABC", "https://feishu.cn.evil.com/base/ABC", "https://u:p@example.feishu.cn/base/ABC", "https://example.feishu.cn:8080/base/ABC", "https://example.feishu.cn/base/a%2Fb", "https://127.0.0.1/base/ABC"] { assert!(parse_link(link).is_err()); }
    }
    #[test]
    fn errors_never_echo_server_messages_or_secrets() {
        let error = check_response(json!({"code":99991672,"msg":"private-secret"})).unwrap_err();
        assert!(error.contains("99991672")); assert!(!error.contains("private-secret"));
        assert!(check_response(json!({"data":{}})).is_err());
        assert!(check_response(json!({"code":0})).is_ok());
    }
    #[test]
    fn status_never_serializes_the_secret() {
        let config = Config { app_id: "cli_test".into(), app_secret: "test-secret-only".into(), url: "https://example.feishu.cn/base/ABC".into() };
        assert!(validate(&config).is_ok());
        let value = serde_json::to_string(&status(Some(&config))).unwrap();
        assert!(!value.contains("test-secret-only")); assert!(!value.contains("appSecret"));
    }
    #[test]
    fn rejects_empty_secret_and_injection_ids() {
        assert!(!valid_id("tbl123/records")); assert!(!valid_id("tbl?x"));
        let config = Config { app_id: "cli_test".into(), app_secret: "".into(), url: "https://example.feishu.cn/base/ABC".into() };
        assert!(validate(&config).is_err());
    }
}
