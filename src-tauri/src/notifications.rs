use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub fn show_task_notification(
    app: AppHandle,
    task_id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    let _ = task_id;
    app.notification()
        .builder()
        .title(format!("Focus AI · {title}"))
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}
