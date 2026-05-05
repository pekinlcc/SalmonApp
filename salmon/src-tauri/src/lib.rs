mod db;
mod engine;
mod commands;
mod permission_bridge;
mod platform;
mod types;

use std::sync::Arc;
use parking_lot::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<db::Db>>,
    pub engine: Arc<engine::EngineRegistry>,
    pub bridge: permission_bridge::PermissionBridge,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GNOME-launched .desktop apps drop stderr to /dev/null, so the
    // existing eprintln! diagnostics in engine.rs / commands.rs are
    // unrecoverable when something goes wrong (e.g. a stuck topic with
    // no visible reply). Redirect fd 2 to a log file in the app data
    // dir before anything else logs.
    redirect_stderr_to_log_file();

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Repair the GUI process's PATH so child CLIs (claude/codex) can be
    // located the same way they would from a user's terminal. On macOS
    // this is mandatory; on Linux it's a no-op.
    platform::fix_path_for_gui();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("resolving app data dir");
            std::fs::create_dir_all(&data_dir).ok();
            migrate_legacy_data_dir(&data_dir);
            let db_path = data_dir.join("salmon.db");
            let db = db::Db::open(&db_path).expect("open salmon.db");

            // Bring up the permission bridge BEFORE the engine — the engine
            // hands its inline-settings JSON to every Claude spawn, so it
            // needs the bound port to exist.
            let app_handle = app.handle().clone();
            let bridge = tauri::async_runtime::block_on(
                permission_bridge::PermissionBridge::start(app_handle.clone()),
            )
            .expect("start permission bridge");
            let engine = engine::EngineRegistry::new(app_handle, bridge.clone());
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                engine: Arc::new(engine),
                bridge,
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
            commands::generate_recommendations,
            commands::list_pending_recommendations,
            commands::list_recent_recommendations,
            commands::decide_recommendation,
            commands::set_danger_mode,
            commands::running_topics,
            commands::debug_log,
            commands::get_home_dir,
            commands::save_pasted_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SalmonApp");
}

/// Open `~/.local/share/app.salmonapp.desktop/salmon.log` in append mode and
/// `dup2` it onto fd 2. Best-effort — silently tolerates failure so a broken
/// HOME / readonly disk never blocks startup.
#[cfg(unix)]
fn redirect_stderr_to_log_file() {
    use std::io::Write;
    use std::os::fd::AsRawFd;

    let Ok(home) = std::env::var("HOME") else { return };
    let dir = std::path::Path::new(&home).join(".local/share/app.salmonapp.desktop");
    if std::fs::create_dir_all(&dir).is_err() { return }
    let path = dir.join("salmon.log");

    let mut f = match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let _ = writeln!(f, "\n=== salmonapp started at {ts} (pid {}) ===", std::process::id());
    let _ = f.flush();
    unsafe { libc::dup2(f.as_raw_fd(), 2); }
    // f drops here, but its underlying fd lives on at fd 2.
}

#[cfg(not(unix))]
fn redirect_stderr_to_log_file() {}

/// One-time copy of the legacy `app.salmon.desktop` data dir into the new
/// `app.salmonapp.desktop` location. Renaming the bundle identifier moved
/// `app_data_dir()` so existing Topics/messages would otherwise look gone.
/// Idempotent: only runs when the new dir has no `salmon.db` yet.
fn migrate_legacy_data_dir(new_dir: &std::path::Path) {
    if new_dir.join("salmon.db").exists() { return }
    let Some(parent) = new_dir.parent() else { return };
    let old_dir = parent.join("app.salmon.desktop");
    if !old_dir.is_dir() { return }
    let Ok(entries) = std::fs::read_dir(&old_dir) else { return };
    for entry in entries.flatten() {
        let src = entry.path();
        if src.is_file() {
            let _ = std::fs::copy(&src, new_dir.join(entry.file_name()));
        }
    }
}
