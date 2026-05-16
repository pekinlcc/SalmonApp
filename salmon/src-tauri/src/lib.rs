mod db;
mod engine;
mod commands;
mod permission_bridge;
mod platform;
mod path_dirs;
mod types;
mod oauth;
mod oauth_config;
mod gmail;
mod gmail_send;
mod microsoft;
mod graph;
mod graph_send;
mod mail_sync;
mod mail_commands;
mod calendar;
mod contacts;
mod briefing;
// v0.9.1 agent pipeline
mod llm;
mod rubric;
mod roost;
mod pulse;
mod briefing_llm;
mod cross_link;
mod writer;
mod event_extractor;
mod task_extractor;
mod tasks;
mod task_pulse;
mod calendar_pulse;
mod cross_pulse;
mod briefing_orchestrator;
mod briefing_commands;

use std::sync::Arc;
use parking_lot::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<db::Db>>,
    pub engine: Arc<engine::EngineRegistry>,
    pub bridge: permission_bridge::PermissionBridge,
    pub oauth_cfg: oauth_config::OauthConfig,
    pub oauth_broker: oauth::OauthBroker,
    /// In-flight guard for the briefing pipeline. `run_briefing` flips this
    /// true on entry and back to false on exit; a concurrent call returns
    /// "already running" instead of racing to write brief_items + clobbering
    /// briefing_state.
    pub briefing_busy: Arc<std::sync::atomic::AtomicBool>,
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

            // v1.1.4: one-time cleanup. Pre-v1.1.3 builds could leave pending
            // brief_items from prior Briefing runs lingering forever — the
            // supersede sweep either didn't exist, ran in the wrong order, or
            // was skipped on a failed run. Any user upgrading from those
            // builds is staring at stacked-up cards on the Contacts view (the
            // Home view's `list_brief_items` already filters by current
            // briefing_id so it was unaffected). Sweep them once on launch:
            // anything pending that isn't part of the current briefing run
            // gets marked `superseded`. Safe to re-run on every launch — it's
            // idempotent and only touches stragglers.
            {
                let now_ms = chrono::Utc::now().timestamp_millis();
                let _ = db.conn().execute(
                    "UPDATE brief_items SET status='superseded', decided_at=?
                     WHERE status='pending'
                       AND briefing_id != COALESCE(
                           (SELECT briefing_id FROM briefing_state WHERE key='current'),
                           ''
                       )",
                    rusqlite::params![now_ms],
                );
            }

            // Bring up the permission bridge BEFORE the engine — the engine
            // hands its inline-settings JSON to every Claude spawn, so it
            // needs the bound port to exist.
            let app_handle = app.handle().clone();
            let bridge = tauri::async_runtime::block_on(
                permission_bridge::PermissionBridge::start(app_handle.clone()),
            )
            .expect("start permission bridge");
            let engine = engine::EngineRegistry::new(app_handle, bridge.clone());
            let oauth_cfg = oauth_config::OauthConfig::load();
            let oauth_broker = oauth::OauthBroker::new();
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                engine: Arc::new(engine),
                bridge,
                oauth_cfg,
                oauth_broker,
                briefing_busy: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_clis,
            commands::quit_app,
            commands::open_link,
            commands::create_topic,
            commands::list_topics,
            commands::delete_topic,
            commands::rename_topic,
            commands::open_topic,
            commands::send_message,
            commands::continue_with_local_context,
            commands::interrupt_topic,
            commands::approve_permission,
            commands::list_messages,
            commands::search_messages,
            commands::search_topic_messages,
            commands::list_workdir_files,
            commands::read_file_text,
            commands::render_office_preview,
            commands::suggest_topic_title,
            commands::get_default_engine,
            commands::set_default_engine,
            commands::get_chat_layout,
            commands::set_chat_layout,
            commands::get_notify_sound,
            commands::set_notify_sound,
            commands::get_composer_send_mode,
            commands::set_composer_send_mode,
            commands::set_archived,
            commands::check_workdir,
            commands::generate_recommendations,
            commands::list_pending_recommendations,
            commands::list_recent_recommendations,
            commands::decide_recommendation,
            commands::set_danger_mode,
            commands::running_topics,
            commands::reset_topic_session,
            commands::debug_log,
            commands::get_home_dir,
            commands::save_pasted_image,
            commands::add_topic_usage,
            commands::set_topic_turn_duration,
            commands::get_usage_summary,
            commands::get_app_data_dir,
            commands::create_quick_topic,
            commands::append_system_message,
            mail_commands::get_oauth_config_path,
            mail_commands::get_oauth_status,
            mail_commands::list_mail_accounts,
            mail_commands::start_gmail_oauth,
            mail_commands::start_outlook_oauth,
            mail_commands::sync_mail_account,
            mail_commands::list_inbox_messages,
            mail_commands::search_mail_messages,
            mail_commands::list_thread_mail,
            mail_commands::list_contact_mail,
            mail_commands::list_contact_brief_items,
            mail_commands::get_mail_message,
            mail_commands::delete_mail_account,
            mail_commands::send_mail,
            mail_commands::save_mail_draft,
            mail_commands::mark_mail_read,
            mail_commands::set_mail_star,
            mail_commands::archive_mail,
            mail_commands::forward_mail,
            mail_commands::sync_calendar,
            mail_commands::list_calendar_events,
            mail_commands::create_calendar_event,
            mail_commands::update_calendar_event,
            mail_commands::delete_calendar_event,
            mail_commands::sync_tasks,
            mail_commands::list_tasks,
            mail_commands::create_task,
            mail_commands::update_task,
            mail_commands::delete_task,
            mail_commands::sync_contacts,
            mail_commands::list_contacts,
            mail_commands::list_unified_contacts,
            mail_commands::get_contact_roost_bundle,
            mail_commands::get_mail_messages_by_ids,
            mail_commands::set_contact_vip,
            mail_commands::set_contact_note,
            mail_commands::get_contact_note,
            mail_commands::build_home_feed,
            briefing_commands::get_briefing_status,
            briefing_commands::run_briefing,
            briefing_commands::list_brief_items,
            briefing_commands::list_brief_history,
            briefing_commands::execute_action_step,
            briefing_commands::decide_brief_item,
            briefing_commands::get_rubric,
            briefing_commands::set_rubric,
            briefing_commands::maybe_edit_rubric,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SalmonApp");
}

/// Open the app log file in append mode and `dup2` it onto fd 2. Best-effort —
/// silently tolerates failure so a broken HOME / readonly disk never blocks
/// startup. Log path comes from `path_dirs::log_dir()`:
///   - macOS: `~/Library/Logs/app.salmonapp.desktop/salmon.log`
///   - Linux: `~/.local/share/app.salmonapp.desktop/salmon.log`
#[cfg(unix)]
fn redirect_stderr_to_log_file() {
    use std::io::Write;
    use std::os::fd::AsRawFd;

    let Some(dir) = path_dirs::log_dir() else { return };
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
