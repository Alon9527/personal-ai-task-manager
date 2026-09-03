use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager, State};

const SQLITE_SCHEMA_VERSION: i64 = 1;
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
        let connection = self.open_connection()?;
        connection
            .query_row(
                "select document_json from workspace_document where singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn save_document(&self, document_json: &str) -> Result<(), String> {
        let document_version = validate_document(document_json)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
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
        transaction.commit().map_err(|error| error.to_string())
    }

    fn backup_document(&self, document_json: &str) -> Result<(), String> {
        validate_backup_document(document_json)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        transaction
            .execute(
                "insert into workspace_document_backup (document_json, created_at)
                 values (?1, current_timestamp)",
                params![document_json],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
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
    connection
        .execute_batch(
            "create table if not exists workspace_document_backup (
               id integer primary key autoincrement,
               document_json text not null,
               created_at text not null default current_timestamp
             );",
        )
        .map_err(|error| error.to_string())?;
    Ok(())
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
pub fn workspace_save_document(
    state: State<'_, WorkspaceStore>,
    document_json: String,
) -> Result<(), String> {
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
