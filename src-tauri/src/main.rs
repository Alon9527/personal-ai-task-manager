#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

mod credential_store;
mod document_import;
mod minimax;
mod notifications;
mod model_provider;
mod openai_compatible;
#[allow(dead_code)] // The backend-only secret read path is not exposed as a Tauri command.
mod provider_credential_store;
mod region_store;
mod voice_typing;
mod workspace_store;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let provider_store = model_provider::ModelProviderStore::initialize(app.handle())
                .map_err(std::io::Error::other)?;
            app.manage(Mutex::new(provider_store));
            let workspace_store = workspace_store::WorkspaceStore::initialize(app.handle())
                .map_err(std::io::Error::other)?;
            app.manage(workspace_store);
            let open = MenuItem::with_id(app, "open", "打开 Focus AI", true, None::<&str>)?;
            let new_task = MenuItem::with_id(app, "new_task", "记录新任务", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &new_task, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("application icon missing").clone())
                .tooltip("Focus AI 个人任务管理器")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "new_task" => {
                        show_main_window(app);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("window.dispatchEvent(new CustomEvent('focus-ai:new-task'))");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            document_import::parse_office_document,
            document_import::open_external_url,
            minimax::minimax_get_status,
            minimax::minimax_save_api_key,
            minimax::minimax_set_region,
            minimax::minimax_delete_api_key,
            minimax::minimax_generate_brief,
            minimax::minimax_ask,
            minimax::ai_generate_brief,
            minimax::ai_ask,
            model_provider::model_provider_list,
            model_provider::model_provider_create,
            model_provider::model_provider_update,
            model_provider::model_provider_replace_api_key,
            model_provider::model_provider_delete,
            model_provider::model_provider_retry_credential_cleanup,
            model_provider::model_provider_test_connection,
            voice_typing::start_windows_voice_typing,
            notifications::show_task_notification,
            workspace_store::workspace_load_document,
            workspace_store::workspace_save_document,
            workspace_store::workspace_backup_document,
            workspace_store::workspace_load_latest_backup,
            workspace_store::workspace_storage_status,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Focus AI desktop application");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
