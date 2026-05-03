mod db;
mod engine;
mod commands;
mod types;

use std::sync::Arc;
use parking_lot::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<db::Db>>,
    pub engine: Arc<engine::EngineRegistry>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("resolving app data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("salmon.db");
            let db = db::Db::open(&db_path).expect("open salmon.db");
            let engine = engine::EngineRegistry::new(app.handle().clone());
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                engine: Arc::new(engine),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_clis,
            commands::create_topic,
            commands::list_topics,
            commands::delete_topic,
            commands::rename_topic,
            commands::open_topic,
            commands::send_message,
            commands::interrupt_topic,
            commands::approve_permission,
            commands::list_messages,
            commands::list_workdir_files,
            commands::read_file_text,
            commands::render_office_preview,
            commands::suggest_topic_title,
            commands::get_default_engine,
            commands::set_default_engine,
            commands::get_chat_layout,
            commands::set_chat_layout,
            commands::set_archived,
            commands::check_workdir,
            commands::set_danger_mode,
            commands::running_topics,
            commands::debug_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Salmon");
}
