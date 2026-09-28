//! SQLite attachment content and immutable references. Call writes inside a transaction.
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::HashSet;

const MAX_BYTES: usize = 5 * 1024 * 1024;
const PREFIX: &str = "attachment:";

pub fn create_table(db: &Connection) -> Result<(), String> {
    db.execute_batch("create table if not exists workspace_attachments (
        id text primary key not null, mime_type text not null,
        size integer not null, content blob not null,
        check (size >= 0 and size <= 5242880 and length(content) = size)
    );
    create table if not exists workspace_attachment_pins (
        backup_id integer not null, attachment_id text not null,
        primary key (backup_id, attachment_id)
    );
    create index if not exists workspace_attachment_pins_by_id on workspace_attachment_pins(attachment_id);
    create table if not exists workspace_attachment_gc_state (
        singleton integer primary key check (singleton = 1), retain_all integer not null
    );
    insert or ignore into workspace_attachment_gc_state values (1, 0);").map_err(|e| e.to_string())
}

pub fn index_backup(db: &Connection, backup_id: i64, raw: &str) -> Result<(), String> {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        db.execute("update workspace_attachment_gc_state set retain_all = 1 where singleton = 1", []).map_err(|e| e.to_string())?;
        return Ok(());
    };
    let mut retained = HashSet::new();
    collect_refs(&value, &mut retained);
    for id in retained {
        db.execute("insert or ignore into workspace_attachment_pins (backup_id,attachment_id) values (?1,?2)", params![backup_id,id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn index_existing_backups(db: &Connection) -> Result<(), String> {
    let mut statement = db.prepare("select id,document_json from workspace_document_backup").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
    for row in rows {
        let (id, raw) = row.map_err(|e| e.to_string())?;
        index_backup(db, id, &raw)?;
    }
    Ok(())
}

fn text<'a>(item: &'a Value, key: &str) -> Result<&'a str, String> {
    item.get(key).and_then(Value::as_str).ok_or_else(|| format!("附件缺少 {key}"))
}

fn metadata(item: &Value) -> Result<(&str, &str, usize), String> {
    let id = text(item, "id")?;
    uuid::Uuid::parse_str(id).map_err(|_| "附件 ID 无效".to_string())?;
    let mime = text(item, "mimeType")?;
    let parts: Vec<_> = mime.split('/').collect();
    if mime.len() > 127 || parts.len() != 2 || parts.iter().any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.+-".contains(&b))) {
        return Err("附件 MIME 类型无效".into());
    }
    let size = item.get("size").and_then(Value::as_u64).filter(|n| *n <= MAX_BYTES as u64)
        .ok_or("附件大小无效或超过 5 MB")? as usize;
    Ok((id, mime, size))
}

pub fn prepare_document(db: &Connection, raw: &str) -> Result<String, String> {
    let mut doc: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let mut changed = false;
    for task in doc.get_mut("tasks").and_then(Value::as_array_mut).ok_or("缺少任务列表")? {
        let Some(items) = task.get_mut("attachments") else { continue };
        let items = items.as_array_mut().ok_or("附件列表无效")?;
        if items.len() > 8 { return Err("每个任务最多 8 个附件".into()); }
        let mut total = 0;
        let mut ids = HashSet::new();
        for item in items {
            let (id, mime, size) = metadata(item)?;
            if !ids.insert(id.to_string()) { return Err("任务包含重复附件 ID".into()); }
            total += size;
            if total > 20 * 1024 * 1024 { return Err("任务附件总大小超过 20 MB".into()); }
            let url = text(item, "dataUrl")?;
            let reference = format!("{PREFIX}{id}");
            if url == reference {
                let valid: bool = db.query_row("select exists(select 1 from workspace_attachments where id = ?1 and mime_type = ?2 and size = ?3)", params![id, mime, size as i64], |row| row.get(0)).map_err(|e| e.to_string())?;
                if !valid { return Err("附件内容缺失或元数据不匹配，请恢复完整备份".into()); }
            } else {
                let payload = url.strip_prefix(&format!("data:{mime};base64,")).ok_or("附件内容格式无效")?;
                if payload.len() > 7_100_000 { return Err("附件内容过大".into()); }
                let bytes = STANDARD.decode(payload).map_err(|_| "附件 Base64 无效")?;
                if bytes.len() != size { return Err("附件内容大小不匹配".into()); }
                let existing: Option<(String, Vec<u8>)> = db.query_row("select mime_type, content from workspace_attachments where id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(|e| e.to_string())?;
                if let Some((stored_mime, stored_bytes)) = existing {
                    if stored_mime != mime || stored_bytes != bytes { return Err("附件 ID 内容冲突，原附件未改变".into()); }
                } else {
                    db.execute("insert into workspace_attachments (id,mime_type,size,content) values (?1,?2,?3,?4)", params![id,mime,size as i64,bytes]).map_err(|e| e.to_string())?;
                }
                item["dataUrl"] = Value::String(reference);
                changed = true;
            }
        }
    }
    if changed { Ok(doc.to_string()) } else { Ok(raw.to_string()) }
}

pub fn load_content(db: &Connection, id: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "附件 ID 无效".to_string())?;
    let (mime, size, bytes): (String, i64, Vec<u8>) = db.query_row("select mime_type,size,content from workspace_attachments where id = ?1", [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
        .optional().map_err(|e| e.to_string())?.ok_or("附件内容不存在，请恢复完整备份")?;
    if bytes.len() as i64 != size || size > MAX_BYTES as i64 { return Err("附件内容损坏".into()); }
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub fn materialize(db: &Connection, raw: &str) -> Result<String, String> {
    let mut doc: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let mut changed = false;
    for task in doc.get_mut("tasks").and_then(Value::as_array_mut).ok_or("缺少任务列表")? {
        let Some(items) = task.get_mut("attachments").and_then(Value::as_array_mut) else { continue };
        for item in items {
            let url = text(item, "dataUrl")?;
            if url.starts_with(PREFIX) {
                let (id, mime, size) = metadata(item)?;
                if url != format!("{PREFIX}{id}") { return Err("附件引用无效".into()); }
                let data = load_content(db, id)?;
                let encoded = data.strip_prefix(&format!("data:{mime};base64,")).ok_or("附件类型不匹配")?;
                if STANDARD.decode(encoded).map_err(|e| e.to_string())?.len() != size { return Err("附件大小不匹配".into()); }
                item["dataUrl"] = Value::String(data);
                changed = true;
            }
        }
    }
    if changed { Ok(doc.to_string()) } else { Ok(raw.to_string()) }
}

// Unknown/corrupt recovery snapshots conservatively pin all content. Never guess.
pub fn collect_unused(db: &Connection, document: &str) -> Result<(), String> {
    let retain_all: bool = db.query_row("select retain_all from workspace_attachment_gc_state where singleton = 1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if retain_all { return Ok(()) }
    let mut retained = HashSet::new();
    collect_refs(&serde_json::from_str::<Value>(document).map_err(|e| e.to_string())?, &mut retained);
    // Hot path reads only small identifiers; backup bodies can contain very large inline files.
    let mut query = db.prepare("select id from workspace_attachments where id not in (select attachment_id from workspace_attachment_pins)").map_err(|e| e.to_string())?;
    let ids = query.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    for id in ids {
        if !retained.contains(&id) { db.execute("delete from workspace_attachments where id = ?1", [id]).map_err(|e| e.to_string())?; }
    }
    Ok(())
}

fn collect_refs(value: &Value, retained: &mut HashSet<String>) {
    match value {
        Value::String(s) => { if let Some(id) = s.strip_prefix(PREFIX) { retained.insert(id.to_string()); } }
        Value::Array(items) => { for item in items { collect_refs(item, retained); } }
        Value::Object(items) => { for item in items.values() { collect_refs(item, retained); } }
        _ => {}
    }
}
