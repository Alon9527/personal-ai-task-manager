use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager, State};

const SQLITE_SCHEMA_VERSION: i64 = 3;
const WORKSPACE_DOCUMENT_FIELDS: [&str; 5] = ["version", "projects", "milestones", "tasks", "quarterGoals"];
const FORBIDDEN_WORKSPACE_KEYS: [&str; 10] = [
    "apikey",
    "credential",
    "credentials",
    "authorization",
    "providerregistry",
    "profile",
    "profiles",
    "baseurl",
    "endpoint",
    "region",
];

pub struct WorkspaceStore {
    database_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStorageStatus {
    driver: &'static str,
    database_path: String,
    schema_version: i64,
}

impl WorkspaceStore {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
        fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
        let store = Self {
            database_path: app_data_dir.join("focus-ai.db"),
        };
        let mut connection = store.open_connection()?;
        migrate(&mut connection)?;
        Ok(store)
    }

    fn open_connection(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.database_path).map_err(|error| error.to_string())?;
        configure(&connection)?;
        Ok(connection)
    }

    pub(crate) fn load_document(&self) -> Result<Option<String>, String> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let original: Option<String> = transaction
            .query_row(
                "select document_json from workspace_document where singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let mut result = original.clone();
        if let Some(raw) = original.as_deref() {
            // Invalid or older documents are handled by the existing renderer recovery/migration.
            if validate_document(raw).is_ok() {
                let canonical = crate::workspace_attachments::prepare_document(&transaction, raw)?;
                if canonical != raw {
                    transaction.execute("insert into workspace_document_backup (document_json) values (?1)", [raw]).map_err(|e| e.to_string())?;
                    crate::workspace_attachments::index_backup(&transaction, transaction.last_insert_rowid(), raw)?;
                    transaction.execute("update workspace_document set document_json = ?1 where singleton = 1", [&canonical]).map_err(|e| e.to_string())?;
                    result = Some(canonical);
                }
            }
        }
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub(crate) fn save_document(&self, document_json: &str) -> Result<String, String> {
        let document_version = validate_document(document_json)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        let document_json = crate::workspace_attachments::prepare_document(&transaction, document_json)?;
        transaction
            .execute(
                "insert into workspace_document (singleton, document_version, document_json, updated_at)
                 values (1, ?1, ?2, current_timestamp)
                 on conflict(singleton) do update set
                   document_version = excluded.document_version,
                   document_json = excluded.document_json,
                   updated_at = excluded.updated_at",
                params![document_version, document_json],
            )
            .map_err(|error| error.to_string())?;
        crate::workspace_attachments::collect_unused(&transaction, &document_json)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(document_json)
    }

    fn backup_document(&self, document_json: &str) -> Result<(), String> {
        validate_backup_document(document_json)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        // Recovery must retain unreadable originals too. Such backups pin content during GC.
        let document_json = crate::workspace_attachments::materialize(&transaction, document_json).unwrap_or_else(|_| document_json.to_string());
        transaction
            .execute(
                "insert into workspace_document_backup (document_json, created_at)
                 values (?1, current_timestamp)",
                params![document_json],
            )
            .map_err(|error| error.to_string())?;
        crate::workspace_attachments::index_backup(&transaction, transaction.last_insert_rowid(), &document_json)?;
        transaction.commit().map_err(|error| error.to_string())
    }

    fn has_applied_plan(&self, plan_id: &str) -> Result<bool, String> {
        validate_plan_id(plan_id)?;
        let connection = self.open_connection()?;
        connection.query_row("select exists(select 1 from workspace_plan_receipts where plan_id = ?1)", [plan_id], |row| row.get(0))
            .map_err(|error| error.to_string())
    }

    fn apply_plan(&self, document_json: &str, expected_json: &str, plan_id: &str) -> Result<String, String> {
        let mut connection = self.open_connection()?;
        apply_plan_transaction(&mut connection, document_json, expected_json, plan_id)
    }

    fn load_latest_backup(&self) -> Result<Option<String>, String> {
        let connection = self.open_connection()?;
        connection
            .query_row(
                "select document_json from workspace_document_backup order by id desc limit 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    #[cfg(test)]
    pub(crate) fn for_test_database(database_path: PathBuf) -> Result<Self, String> {
        let store = Self { database_path };
        let mut connection = store.open_connection()?;
        migrate(&mut connection)?;
        Ok(store)
    }

    fn status(&self) -> Result<WorkspaceStorageStatus, String> {
        let connection = self.open_connection()?;
        let schema_version = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| error.to_string())?;
        Ok(WorkspaceStorageStatus {
            driver: "sqlite",
            database_path: self.database_path.to_string_lossy().into_owned(),
            schema_version,
        })
    }
}

fn configure(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn migrate(connection: &mut Connection) -> Result<(), String> {
    let current: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if current > SQLITE_SCHEMA_VERSION {
        return Err(format!(
            "数据库版本 {current} 高于当前软件支持的版本 {SQLITE_SCHEMA_VERSION}"
        ));
    }
    if current < 1 {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        transaction
            .execute_batch(
                "create table if not exists workspace_document (
                   singleton integer primary key check (singleton = 1),
                   document_version integer not null,
                   document_json text not null,
                   updated_at text not null default current_timestamp
                 );",
            )
            .map_err(|error| error.to_string())?;
        transaction
            .pragma_update(None, "user_version", 1)
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    if current < 2 {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        transaction.execute_batch("create table if not exists workspace_plan_receipts (
            plan_id text primary key not null,
            applied_at text not null default current_timestamp
        );").map_err(|error| error.to_string())?;
        transaction.pragma_update(None, "user_version", 2).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    connection
        .execute_batch(
            "create table if not exists workspace_document_backup (
               id integer primary key autoincrement,
               document_json text not null,
               created_at text not null default current_timestamp
             );",
        )
        .map_err(|error| error.to_string())?;
    if current < 3 {
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        crate::workspace_attachments::create_table(&transaction)?;
        crate::workspace_attachments::index_existing_backups(&transaction)?;
        transaction.pragma_update(None, "user_version", 3).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate_plan_id(plan_id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(plan_id).map(|_| ()).map_err(|_| "计划 ID 无效".to_string())
}

fn apply_plan_transaction(connection: &mut Connection, document_json: &str, expected_json: &str, plan_id: &str) -> Result<String, String> {
    validate_plan_id(plan_id)?;
    let version = validate_document(document_json)?;
    validate_document(expected_json)?;
    let expected: Value = serde_json::from_str(expected_json).map_err(|error| error.to_string())?;
    // Take the write lock BEFORE reading the base or receipt. Both writes commit together.
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error| error.to_string())?;
    let applied: bool = transaction.query_row("select exists(select 1 from workspace_plan_receipts where plan_id = ?1)", [plan_id], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if applied { return Err("PLAN_ALREADY_APPLIED".into()); }
    let current: String = transaction.query_row("select document_json from workspace_document where singleton = 1", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let current_value: Value = serde_json::from_str(&current).map_err(|_| "工作区无法读取，请先恢复有效备份".to_string())?;
    if current_value != expected { return Err("WORKSPACE_CONFLICT".into()); }
    let document_json = crate::workspace_attachments::prepare_document(&transaction, document_json)?;
    transaction.execute("update workspace_document set document_json = ?1, document_version = ?2, updated_at = current_timestamp where singleton = 1", params![document_json, version])
        .map_err(|error| error.to_string())?;
    transaction.execute("insert into workspace_plan_receipts (plan_id) values (?1)", [plan_id])
        .map_err(|error| error.to_string())?;
    crate::workspace_attachments::collect_unused(&transaction, &document_json)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(document_json)
}

fn validate_document(document_json: &str) -> Result<i64, String> {
    let value: Value = serde_json::from_str(document_json)
        .map_err(|error| format!("工作区 JSON 无效：{error}"))?;
    validate_workspace_document_shape(&value)?;
    reject_forbidden_workspace_material(&value)?;
    let version = value
        .get("version")
        .and_then(Value::as_i64)
        .ok_or_else(|| "工作区缺少版本号".to_string())?;
    if version != 3 {
        return Err(format!("工作区版本 {version} 无效，当前仅接受版本 3"));
    }
    for field in ["projects", "milestones", "tasks", "quarterGoals"] {
        if !value.get(field).is_some_and(Value::is_array) {
            return Err(format!("工作区缺少 {field} 数组"));
        }
    }
    Ok(version)
}

fn validate_workspace_document_shape(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "工作区 JSON 必须是对象".to_string())?;
    if object.len() != WORKSPACE_DOCUMENT_FIELDS.len()
        || WORKSPACE_DOCUMENT_FIELDS.iter().any(|field| !object.contains_key(*field))
        || object.keys().any(|field| !WORKSPACE_DOCUMENT_FIELDS.contains(&field.as_str()))
    {
        return Err("工作区只能包含 v3 工作区字段".to_string());
    }
    Ok(())
}

fn reject_forbidden_workspace_material(value: &Value) -> Result<(), String> {
    match value {
        Value::Object(object) => {
            for (key, nested) in object {
                if is_forbidden_workspace_key(key) {
                    return Err("工作区不能包含模型服务商或凭据字段".to_string());
                }
                reject_forbidden_workspace_material(nested)?;
            }
        }
        Value::Array(values) => {
            for nested in values {
                reject_forbidden_workspace_material(nested)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_backup_document(document_json: &str) -> Result<(), String> {
    match serde_json::from_str::<Value>(document_json) {
        Ok(value) => reject_forbidden_workspace_material(&value),
        Err(_) if contains_json_like_forbidden_key(document_json) => {
            Err("工作区恢复备份疑似包含模型服务商或凭据字段".to_string())
        }
        Err(_) => Ok(()),
    }
}

enum JsonStringToken {
    Valid { decoded: String, raw_end: usize },
    Invalid { raw_end: Option<usize> },
}

enum JsonContainer {
    Object,
    Array,
}

fn contains_json_like_forbidden_key(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    let mut containers = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'{' => {
                containers.push(JsonContainer::Object);
                index += 1;
            }
            b'[' => {
                containers.push(JsonContainer::Array);
                index += 1;
            }
            b'}' | b']' => {
                containers.pop();
                index += 1;
            }
            b'"' => {
                match lex_json_string_token(raw, index) {
                    JsonStringToken::Valid { decoded, raw_end } => {
                        let after_token = skip_json_whitespace(bytes, raw_end + 1);
                        if bytes.get(after_token) == Some(&b':') {
                            if is_forbidden_workspace_key(&decoded) {
                                return true;
                            }
                        }
                        index = raw_end + 1;
                    }
                    JsonStringToken::Invalid { raw_end: Some(raw_end) } => {
                        let after_token = skip_json_whitespace(bytes, raw_end + 1);
                        if bytes.get(after_token) == Some(&b':') {
                            return true;
                        }
                        index = raw_end + 1;
                    }
                    JsonStringToken::Invalid { raw_end: None } => {
                        return matches!(containers.last(), Some(JsonContainer::Object))
                            && matches!(
                                previous_json_non_whitespace(bytes, index),
                                Some(b'{') | Some(b','),
                            );
                    }
                }
            }
            byte if is_unquoted_key_byte(byte) => {
                let start = index;
                while index < bytes.len() && is_unquoted_key_byte(bytes[index]) {
                    index += 1;
                }
                let after_token = skip_json_whitespace(bytes, index);
                if bytes.get(after_token) == Some(&b':') {
                    if let Ok(candidate) = std::str::from_utf8(&bytes[start..index]) {
                        if is_forbidden_workspace_key(candidate) {
                            return true;
                        }
                    }
                }
            }
            _ => index += 1,
        }
    }
    false
}

fn is_unquoted_key_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'$')
}

fn previous_json_non_whitespace(bytes: &[u8], before: usize) -> Option<u8> {
    bytes[..before]
        .iter()
        .rev()
        .copied()
        .find(|byte| !byte.is_ascii_whitespace())
}

fn lex_json_string_token(raw: &str, opening_quote: usize) -> JsonStringToken {
    let bytes = raw.as_bytes();
    let mut index = opening_quote + 1;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => {
                let token = &raw[opening_quote..=index];
                return match serde_json::from_str::<String>(token) {
                    Ok(decoded) => JsonStringToken::Valid { decoded, raw_end: index },
                    Err(_) => JsonStringToken::Invalid { raw_end: Some(index) },
                };
            }
            b'\\' => {
                index += 1;
                let Some(escaped) = bytes.get(index) else {
                    return JsonStringToken::Invalid { raw_end: None };
                };
                match *escaped {
                    b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => index += 1,
                    b'u' => {
                        let mut digits = 0;
                        index += 1;
                        while digits < 4 {
                            let Some(next) = bytes.get(index) else {
                                return JsonStringToken::Invalid { raw_end: None };
                            };
                            if !next.is_ascii_hexdigit() {
                                if *next == b'"' {
                                    return JsonStringToken::Invalid { raw_end: Some(index) };
                                }
                                break;
                            }
                            digits += 1;
                            index += 1;
                        }
                        if digits != 4 {
                            continue;
                        }
                    }
                    _ => {
                        index += 1;
                    }
                }
            }
            _ => index += 1,
        }
    }
    JsonStringToken::Invalid { raw_end: None }
}

fn skip_json_whitespace(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    index
}

fn normalize_workspace_key(key: &str) -> String {
    key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_forbidden_workspace_key(key: &str) -> bool {
    let normalized = normalize_workspace_key(key);
    FORBIDDEN_WORKSPACE_KEYS.contains(&normalized.as_str())
        || [
            "apikey",
            "authorization",
            "credential",
            "baseurl",
            "endpoint",
            "region",
            "provider",
            "providerprofile",
            "providerregistry",
        ]
        .iter()
        .any(|alias| normalized.contains(alias))
}

#[tauri::command]
pub fn workspace_load_document(state: State<'_, WorkspaceStore>) -> Result<Option<String>, String> {
    state.load_document()
}

#[tauri::command]
pub fn workspace_load_raw_document(state: State<'_, WorkspaceStore>) -> Result<Option<String>, String> {
    state.open_connection()?.query_row("select document_json from workspace_document where singleton = 1", [], |r| r.get(0)).optional().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_load_attachment(state: State<'_, WorkspaceStore>, attachment_id: String) -> Result<String, String> {
    crate::workspace_attachments::load_content(&state.open_connection()?, &attachment_id)
}

#[tauri::command]
pub fn workspace_has_applied_plan(state: State<'_, WorkspaceStore>, plan_id: String) -> Result<bool, String> {
    state.has_applied_plan(&plan_id)
}

#[tauri::command]
pub fn workspace_apply_plan(state: State<'_, WorkspaceStore>, document_json: String, expected_json: String, plan_id: String) -> Result<String, String> {
    state.apply_plan(&document_json, &expected_json, &plan_id)
}

#[tauri::command]
pub fn workspace_save_document(
    state: State<'_, WorkspaceStore>,
    document_json: String,
) -> Result<String, String> {
    state.save_document(&document_json)
}

#[tauri::command]
pub fn workspace_backup_document(
    state: State<'_, WorkspaceStore>,
    document_json: String,
) -> Result<(), String> {
    state.backup_document(&document_json)
}

#[tauri::command]
pub fn workspace_load_latest_backup(
    state: State<'_, WorkspaceStore>,
) -> Result<Option<String>, String> {
    state.load_latest_backup()
}

#[tauri::command]
pub fn workspace_storage_status(
    state: State<'_, WorkspaceStore>,
) -> Result<WorkspaceStorageStatus, String> {
    state.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store(case_id: &str) -> (WorkspaceStore, PathBuf) {
        let directory = std::env::temp_dir()
            .join("focus-ai-workspace-store-tests")
            .join(case_id);
        fs::create_dir_all(&directory).unwrap();
        let database_path = directory.join("focus-ai.db");
        remove_test_database(&database_path);
        let store = WorkspaceStore {
            database_path: database_path.clone(),
        };
        let mut connection = store.open_connection().unwrap();
        migrate(&mut connection).unwrap();
        (store, database_path)
    }

    fn remove_test_database(database_path: &std::path::Path) {
        remove_test_file(database_path);
        remove_test_file(&database_path.with_file_name("focus-ai.db-wal"));
        remove_test_file(&database_path.with_file_name("focus-ai.db-shm"));
    }

    fn remove_test_file(path: &std::path::Path) {
        if path.is_file() {
            fs::remove_file(path).unwrap();
        }
    }

    fn document() -> &'static str {
        r#"{"version":3,"projects":[],"milestones":[],"tasks":[],"quarterGoals":[]}"#
    }

    fn attachment_document() -> String {
        serde_json::json!({"version":3,"projects":[],"milestones":[],"quarterGoals":[],"tasks":[{
            "title":"attachment test", "attachments":[{"id":"40000000-0000-4000-8000-000000000001",
            "name":"sample.png","mimeType":"image/png","size":3,"dataUrl":"data:image/png;base64,AQID"}]
        }]}).to_string()
    }

    #[test]
    fn attachments_are_stored_outside_the_workspace_json() {
        let (store, path) = test_store("attachments-separated");
        store.save_document(&attachment_document()).unwrap();
        let saved = store.load_document().unwrap().unwrap();
        assert!(!saved.contains("base64"), "normal task data must not carry file bytes");
        assert!(saved.contains("attachment:40000000-0000-4000-8000-000000000001"));
        let db = store.open_connection().unwrap();
        let bytes: Vec<u8> = db.query_row("select content from workspace_attachments", [], |row| row.get(0)).unwrap();
        assert_eq!(bytes, vec![1,2,3]);
        drop(db);
        remove_test_database(&path);
    }

    #[test]
    fn attachment_migration_failure_preserves_the_original_and_no_partial_blobs() {
        let (store, path) = test_store("attachments-migration-fails");
        let db = store.open_connection().unwrap();
        let original = attachment_document();
        db.execute("insert into workspace_document (singleton, document_version, document_json) values (1,3,?1)", [&original]).unwrap();
        db.execute_batch("create trigger fail_blob before insert on workspace_attachments begin select raise(abort, 'disk failure'); end;").unwrap();
        assert!(store.load_document().is_err());
        let kept: String = db.query_row("select document_json from workspace_document", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, original);
        assert_eq!(db.query_row("select count(*) from workspace_attachments", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert!(store.load_latest_backup().unwrap().is_none());
        drop(db);
        remove_test_database(&path);
    }

    #[test]
    fn attachment_content_and_receipt_roll_back_together_on_plan_failure() {
        let (store, path) = test_store("attachments-plan-atomic");
        store.save_document(document()).unwrap();
        let db = store.open_connection().unwrap();
        db.execute_batch("create trigger fail_receipt before insert on workspace_plan_receipts begin select raise(abort, 'failure'); end;").unwrap();
        let id = "10000000-0000-4000-8000-000000000009";
        assert!(store.apply_plan(&attachment_document(), document(), id).is_err());
        assert!(!store.has_applied_plan(id).unwrap());
        assert_eq!(db.query_row("select count(*) from workspace_attachments", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(store.load_document().unwrap().unwrap(), document());
        db.execute_batch("drop trigger fail_receipt;").unwrap();
        let saved = store.apply_plan(&attachment_document(), document(), id).unwrap();
        assert!(!saved.contains("base64"));
        assert!(store.has_applied_plan(id).unwrap());
        assert_eq!(store.apply_plan(document(), &saved, id).unwrap_err(), "PLAN_ALREADY_APPLIED");
        drop(db);
        remove_test_database(&path);
    }

    #[test]
    fn attachment_backup_is_portable_after_clear_and_restore_on_another_database() {
        let (store, path) = test_store("attachments-backup");
        let saved = store.save_document(&attachment_document()).unwrap();
        store.backup_document(&saved).unwrap();
        let backup = store.load_latest_backup().unwrap().unwrap();
        assert_eq!(serde_json::from_str::<Value>(&backup).unwrap(), serde_json::from_str::<Value>(&attachment_document()).unwrap());
        store.save_document(document()).unwrap();
        let db = store.open_connection().unwrap();
        assert_eq!(db.query_row("select count(*) from workspace_attachments", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        let (other, other_path) = test_store("attachments-restore-other");
        let restored = other.save_document(&backup).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&restored).unwrap(), serde_json::from_str::<Value>(&saved).unwrap());
        assert_eq!(crate::workspace_attachments::load_content(&other.open_connection().unwrap(), "40000000-0000-4000-8000-000000000001").unwrap(), "data:image/png;base64,AQID");
        drop(db);
        remove_test_database(&path);
        remove_test_database(&other_path);
    }

    #[test]
    fn references_do_not_rewrite_blobs_and_soft_delete_keeps_them() {
        let (store, path) = test_store("attachments-lifecycle");
        let saved = store.save_document(&attachment_document()).unwrap();
        let db = store.open_connection().unwrap();
        db.execute_batch("create trigger no_blob_rewrite before update on workspace_attachments begin select raise(abort, 'unexpected blob rewrite'); end;").unwrap();
        let mut edited: Value = serde_json::from_str(&saved).unwrap();
        edited["tasks"][0]["deletedAt"] = Value::String("2026-09-27T00:00:00Z".into());
        store.save_document(&edited.to_string()).unwrap();
        assert_eq!(crate::workspace_attachments::load_content(&db, "40000000-0000-4000-8000-000000000001").unwrap(), "data:image/png;base64,AQID");
        store.save_document(&saved).unwrap();
        assert!(store.save_document(&attachment_document().replace("AQID", "BAUG")).is_err());
        assert!(store.save_document(&attachment_document().replace("AQID", "AQ==")).is_err());
        store.backup_document("{corrupt recovery snapshot").unwrap();
        store.save_document(document()).unwrap();
        assert_eq!(db.query_row("select count(*) from workspace_attachments", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        drop(db);
        remove_test_database(&path);
    }

    #[test]
    fn missing_referenced_attachment_blocks_load_without_overwriting_the_document() {
        let (store, path) = test_store("attachments-missing");
        let saved = store.save_document(&attachment_document()).unwrap();
        let db = store.open_connection().unwrap();
        db.execute("delete from workspace_attachments where id = ?1", ["40000000-0000-4000-8000-000000000001"]).unwrap();
        assert!(store.load_document().is_err(), "dangling references must enter recovery instead of pretending success");
        assert_eq!(db.query_row("select document_json from workspace_document", [], |r| r.get::<_, String>(0)).unwrap(), saved);
        drop(db);
        remove_test_database(&path);
    }

    #[test]
    fn backup_reference_index_pins_corrupt_content_without_rescanning_backup_bodies() {
        let (store, path) = test_store("attachments-backup-index");
        let original_id = "40000000-0000-4000-8000-000000000001";
        let saved = store.save_document(&attachment_document()).unwrap();
        let db = store.open_connection().unwrap();
        db.execute("update workspace_attachments set mime_type = 'application/octet-stream' where id = ?1", [original_id]).unwrap();
        assert!(store.load_document().is_err());
        store.backup_document(&saved).unwrap();
        let index_count = db.query_row("select count(*) from workspace_attachment_pins where attachment_id = ?1", [original_id], |r| r.get::<_, i64>(0));
        assert!(matches!(index_count, Ok(1)), "recovery backups must have a precomputed reference index");
        // Explicit restore gives the portable file a fresh ID; it never overwrites corrupt evidence.
        let new_id = "40000000-0000-4000-8000-000000000002";
        store.save_document(&attachment_document().replace(original_id, new_id)).unwrap();
        assert_eq!(crate::workspace_attachments::load_content(&db, new_id).unwrap(), "data:image/png;base64,AQID");
        assert_eq!(db.query_row("select count(*) from workspace_attachments", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        drop(db);
        remove_test_database(&path);
    }

    #[test]
    fn schema_two_backups_are_indexed_once_and_pin_unreadable_snapshots() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table workspace_document_backup (id integer primary key, document_json text not null, created_at text);
            insert into workspace_document_backup values (1, '{corrupt old backup', 'before'); pragma user_version = 2;").unwrap();
        migrate(&mut db).unwrap();
        assert_eq!(db.query_row("select retain_all from workspace_attachment_gc_state", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 3);
        assert_eq!(db.query_row("select document_json from workspace_document_backup where id = 1", [], |r| r.get::<_, String>(0)).unwrap(), "{corrupt old backup");
    }

    #[test]
    fn megabyte_attachment_is_absent_from_subsequent_task_save_payloads() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let (store, path) = test_store("attachments-size");
        let mut original: Value = serde_json::from_str(&attachment_document()).unwrap();
        original["tasks"][0]["attachments"][0]["size"] = Value::from(1024 * 1024);
        original["tasks"][0]["attachments"][0]["dataUrl"] = Value::from(format!("data:image/png;base64,{}", STANDARD.encode(vec![1u8;1024*1024])));
        let inline = original.to_string();
        assert!(inline.len() > 1_000_000);
        let compact = store.save_document(&inline).unwrap();
        assert!(compact.len() < 500, "ordinary edits must carry only small file references");
        let db = store.open_connection().unwrap();
        db.execute_batch("create trigger reject_insert before insert on workspace_attachments begin select raise(abort,'unexpected insert'); end;
            create trigger reject_update before update on workspace_attachments begin select raise(abort,'unexpected update'); end;").unwrap();
        store.save_document(&compact).unwrap();
        drop(db);
        remove_test_database(&path);
    }

    #[test]
    fn legacy_attachments_migrate_on_read_with_an_original_backup() {
        let (store, path) = test_store("attachments-legacy");
        let db = store.open_connection().unwrap();
        db.execute("insert into workspace_document (singleton, document_version, document_json) values (1,3,?1)", [attachment_document()]).unwrap();
        drop(db);
        let loaded = store.load_document().unwrap().unwrap();
        assert!(!loaded.contains("base64"), "legacy read must migrate to references");
        assert_eq!(store.load_latest_backup().unwrap().unwrap(), attachment_document());
        remove_test_database(&path);
    }

    #[test]
    fn migrates_a_plan_receipt_ledger_without_replacing_existing_data() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table workspace_document (singleton integer primary key, document_version integer, document_json text, updated_at text); pragma user_version = 1;").unwrap();
        db.execute("insert into workspace_document values (1, 3, ?1, 'before')", [document()]).unwrap();
        migrate(&mut db).unwrap();
        let receipts = db.query_row("select count(*) from workspace_plan_receipts", [], |row| row.get::<_, i64>(0));
        assert!(receipts.is_ok(), "safe plan execution requires a durable receipt table");
        let saved: String = db.query_row("select document_json from workspace_document", [], |row| row.get(0)).unwrap();
        assert_eq!(saved, document());
    }

    #[test]
    fn plan_commit_is_atomic_idempotent_and_checks_the_current_base() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        db.execute("insert into workspace_document (singleton, document_version, document_json) values (1, 3, ?1)", [document()]).unwrap();
        let id = "10000000-0000-4000-8000-000000000001";
        let next = r#"{"version":3,"projects":[],"milestones":[],"tasks":[{"title":"only once"}],"quarterGoals":[]}"#;
        apply_plan_transaction(&mut db, next, document(), id).unwrap();
        // A stale renderer cannot replay the same plan even with a different replacement.
        assert_eq!(apply_plan_transaction(&mut db, document(), next, id).unwrap_err(), "PLAN_ALREADY_APPLIED");
        assert_eq!(apply_plan_transaction(&mut db, document(), document(), "10000000-0000-4000-8000-000000000002").unwrap_err(), "WORKSPACE_CONFLICT");
        let saved: String = db.query_row("select document_json from workspace_document", [], |row| row.get(0)).unwrap();
        assert_eq!(saved, next);
        let count: i64 = db.query_row("select count(*) from workspace_plan_receipts", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn receipt_failure_rolls_back_the_document_write_and_allows_safe_retry() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        db.execute("insert into workspace_document (singleton, document_version, document_json) values (1, 3, ?1)", [document()]).unwrap();
        db.execute_batch("create trigger fail_receipt before insert on workspace_plan_receipts begin select raise(abort, 'synthetic disk failure'); end;").unwrap();
        let next = r#"{"version":3,"projects":[],"milestones":[],"tasks":[{"title":"rollback"}],"quarterGoals":[]}"#;
        let id = "10000000-0000-4000-8000-000000000001";
        assert!(apply_plan_transaction(&mut db, next, document(), id).is_err());
        let saved: String = db.query_row("select document_json from workspace_document", [], |row| row.get(0)).unwrap();
        assert_eq!(saved, document());
        let count: i64 = db.query_row("select count(*) from workspace_plan_receipts", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
        db.execute_batch("drop trigger fail_receipt;").unwrap();
        apply_plan_transaction(&mut db, next, document(), id).unwrap();
    }

    #[test]
    fn plan_receipt_survives_reopening_the_database_and_normal_workspace_replacement() {
        let (store, path) = test_store("plan-receipt-restart");
        store.save_document(document()).unwrap();
        let id = "10000000-0000-4000-8000-000000000001";
        store.apply_plan(document(), document(), id).unwrap();
        drop(store);
        let reopened = WorkspaceStore::for_test_database(path.clone()).unwrap();
        assert!(reopened.has_applied_plan(id).unwrap());
        reopened.save_document(document()).unwrap();
        assert_eq!(reopened.apply_plan(document(), document(), id).unwrap_err(), "PLAN_ALREADY_APPLIED");
        assert!(reopened.has_applied_plan("not-a-plan-id").is_err());
        drop(reopened);
        remove_test_database(&path);
    }

    #[test]
    fn migrates_an_empty_database_and_round_trips_the_workspace() {
        let mut connection = Connection::open_in_memory().unwrap();
        configure(&connection).unwrap();
        migrate(&mut connection).unwrap();
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, SQLITE_SCHEMA_VERSION);

        let document_version = validate_document(document()).unwrap();
        connection
            .execute(
                "insert into workspace_document (singleton, document_version, document_json) values (1, ?1, ?2)",
                params![document_version, document()],
            )
            .unwrap();
        let saved: String = connection
            .query_row(
                "select document_json from workspace_document where singleton = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(saved, document());
    }

    #[test]
    fn rejects_invalid_workspace_json() {
        assert!(validate_document("not json").is_err());
        assert!(validate_document(
            r#"{"version":2,"projects":[],"milestones":[],"tasks":[],"quarterGoals":[]}"#
        )
        .is_err());
        for field in ["projects", "milestones", "tasks", "quarterGoals"] {
            let mut missing: Value = serde_json::from_str(document()).unwrap();
            missing.as_object_mut().unwrap().remove(field);
            assert!(
                validate_document(&missing.to_string()).is_err(),
                "missing {field} must be rejected"
            );

            let mut invalid: Value = serde_json::from_str(document()).unwrap();
            invalid[field] = Value::String("not-an-array".to_string());
            assert!(
                validate_document(&invalid.to_string()).is_err(),
                "non-array {field} must be rejected"
            );
        }
    }

    #[test]
    fn direct_sqlite_save_rejects_unknown_and_recursive_provider_material_without_replacing_workspace() {
        let (store, database_path) = test_store("reject-provider-material-save");
        store.save_document(document()).unwrap();

        for sensitive_document in [
            r#"{"version":3,"projects":[{"apiKey":"synthetic-save-secret"}],"milestones":[],"tasks":[],"quarterGoals":[]}"#,
            r#"{"version":3,"projects":[],"milestones":[],"tasks":[{"endpoint":"https://api.example.invalid/v1"}],"quarterGoals":[]}"#,
            r#"{"version":3,"projects":[],"milestones":[],"tasks":[],"quarterGoals":[],"providerRegistry":{"profiles":[]}}"#,
            r#"{"version":3,"projects":[],"milestones":[],"tasks":[],"quarterGoals":[],"unexpected":"value"}"#,
        ] {
            assert!(store.save_document(sensitive_document).is_err());
        }

        assert_eq!(store.load_document().unwrap().as_deref(), Some(document()));
        let connection = store.open_connection().unwrap();
        let copied_document: String = connection
            .query_row(
                "select document_json from workspace_document where singleton = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!copied_document.contains("synthetic-save-secret"));
        assert_eq!(copied_document, document());
        drop(connection);
        remove_test_database(&database_path);
    }

    #[test]
    fn direct_sqlite_backup_rejects_parseable_and_json_like_sensitive_material_but_keeps_non_sensitive_corruption_byte_exact() {
        let (store, database_path) = test_store("reject-provider-material-backup");
        store.save_document(document()).unwrap();

        assert!(store
            .backup_document(r#"{"version":3,"projects":[],"milestones":[],"tasks":[{"credential":"synthetic-backup-secret"}],"quarterGoals":[]}"#)
            .is_err());
        assert!(store
            .backup_document(r#"{"apiKey" : "synthetic-truncated-secret"#)
            .is_err());
        assert_eq!(store.load_latest_backup().unwrap(), None);
        assert_eq!(store.load_document().unwrap().as_deref(), Some(document()));

        let corrupt_but_non_sensitive = "{corrupt-non-sensitive";
        store.backup_document(corrupt_but_non_sensitive).unwrap();
        assert_eq!(store.load_latest_backup().unwrap().as_deref(), Some(corrupt_but_non_sensitive));
        remove_test_database(&database_path);
    }

    #[test]
    fn malformed_backup_decodes_escaped_sensitive_key_tokens_without_mistaking_values_for_keys() {
        let (store, database_path) = test_store("escaped-provider-material-backup");
        store.save_document(document()).unwrap();

        for sensitive_raw in [
            r#"{"api\u004bey" : "synthetic-escaped-key"#,
            r#"{"AuThOrI\u005aAtIoN" : "synthetic-escaped-authorization"#,
            r#"{"api\uD800Key" : "synthetic-invalid-surrogate"#,
            r#"{"api\u00ZZKey" : "synthetic-invalid-escape"#,
        ] {
            assert!(store.backup_document(sensitive_raw).is_err(), "{sensitive_raw}");
        }
        assert_eq!(store.load_latest_backup().unwrap(), None);

        let value_only_raw = r#"{"note":"apiKey",}"#;
        store.backup_document(value_only_raw).unwrap();
        assert_eq!(store.load_latest_backup().unwrap().as_deref(), Some(value_only_raw));
        remove_test_database(&database_path);
    }

    #[test]
    fn rejects_compound_sensitive_alias_keys_in_direct_saves_and_backups_without_value_false_positives() {
        let (store, database_path) = test_store("compound-sensitive-aliases");
        store.save_document(document()).unwrap();

        for key in [
            "providerApiKey",
            "providerProfile",
            "providerEndpoint",
            "providerRegion",
            "modelProvider",
            "customAuthorization",
            "providerBaseUrl",
            "credentialValue",
        ] {
            let parsed = format!(
                r#"{{"version":3,"projects":[],"milestones":[],"tasks":[{{"{key}":"synthetic-secret"}}],"quarterGoals":[]}}"#
            );
            assert!(store.save_document(&parsed).is_err(), "parsed key {key}");

            let escaped = key.replace('A', "\\u0041").replace('P', "\\u0050");
            let malformed = format!(r#"{{"{escaped}":"synthetic-secret"#);
            assert!(store.backup_document(&malformed).is_err(), "malformed key {key}");

            let unquoted_malformed = format!(r#"{{{key}:"synthetic-secret"}}"#);
            assert!(
                store.backup_document(&unquoted_malformed).is_err(),
                "unquoted malformed key {key}"
            );
        }

        let normal_task_text = r#"{"note":"providerApiKey: providerProfile: providerEndpoint: providerRegion: modelProvider: customAuthorization: providerBaseUrl: credentialValue:",}"#;
        store.backup_document(normal_task_text).unwrap();
        assert_eq!(store.load_latest_backup().unwrap().as_deref(), Some(normal_task_text));
        assert_eq!(store.load_document().unwrap().as_deref(), Some(document()));
        remove_test_database(&database_path);
    }

    #[test]
    fn malformed_backup_lexes_short_unicode_escapes_quotes_and_trailing_backslashes_without_losing_key_context() {
        let (store, database_path) = test_store("malformed-string-lexer-backup");

        for invalid_key_raw in [
            r#"{"apiKey\u0":"synthetic-secret"#,
            r#"{"apiKey\u":"synthetic-short"#,
            r#"{"api\"Key":"synthetic-escaped-quote"#,
            r#"{"apiKey\"#,
        ] {
            assert!(store.backup_document(invalid_key_raw).is_err(), "{invalid_key_raw}");
        }
        assert_eq!(store.load_latest_backup().unwrap(), None);

        let invalid_value_only_raw = r#"{"note":"apiKey\u0"#;
        store.backup_document(invalid_value_only_raw).unwrap();
        assert_eq!(store.load_latest_backup().unwrap().as_deref(), Some(invalid_value_only_raw));

        let invalid_value_before_colon_raw = r#"{"note":"apiKey\u0":"still-a-value"#;
        assert!(store.backup_document(invalid_value_before_colon_raw).is_err());

        let corrupt_but_non_sensitive = "{corrupt-non-sensitive";
        store.backup_document(corrupt_but_non_sensitive).unwrap();
        assert_eq!(store.load_latest_backup().unwrap().as_deref(), Some(corrupt_but_non_sensitive));
        remove_test_database(&database_path);
    }

    #[test]
    fn malformed_backup_classifies_complete_key_candidates_by_their_following_colon() {
        let (store, database_path) = test_store("syntax-local-key-candidate-backup");

        for sensitive_raw in [
            r#"{"note":0 "apiKey":"synthetic-missing-comma"#,
            r#"{"outer":{"note":0 "apiKey":"synthetic-nested-missing-comma"#,
            r#"{"outer":[} "apiKey":"synthetic-mismatched-delimiter"#,
            r#"{"note":0 "api\u004bey":"synthetic-escaped-missing-comma"#,
        ] {
            assert!(store.backup_document(sensitive_raw).is_err(), "{sensitive_raw}");
        }
        assert_eq!(store.load_latest_backup().unwrap(), None);

        for non_sensitive_raw in [
            r#"{"note":"apiKey",}"#,
            r#"{"note":"apiKey"} trailing"#,
            r#"{"note":"apiKey""#,
            r#"{"note":"prefix:apiKey",}"#,
        ] {
            store.backup_document(non_sensitive_raw).unwrap();
            assert_eq!(
                store.load_latest_backup().unwrap().as_deref(),
                Some(non_sensitive_raw),
                "{non_sensitive_raw}",
            );
        }

        remove_test_database(&database_path);
    }

    #[test]
    fn keeps_raw_recovery_backups_without_changing_the_physical_schema_version() {
        let mut connection = Connection::open_in_memory().unwrap();
        configure(&connection).unwrap();
        migrate(&mut connection).unwrap();
        connection
            .execute(
                "insert into workspace_document_backup (document_json) values (?1)",
                params!["{corrupt-one"],
            )
            .unwrap();
        connection
            .execute(
                "insert into workspace_document_backup (document_json) values (?1)",
                params!["{corrupt-two"],
            )
            .unwrap();

        let latest: String = connection
            .query_row(
                "select document_json from workspace_document_backup order by id desc limit 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();

        assert_eq!(latest, "{corrupt-two");
        assert_eq!(version, SQLITE_SCHEMA_VERSION);
    }
}
