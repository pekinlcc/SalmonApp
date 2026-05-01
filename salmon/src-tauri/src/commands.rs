use crate::types::{CliInfo, Message, Topic};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    format!("{e}")
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub clis: Vec<CliInfo>,
}

#[tauri::command]
pub fn detect_clis() -> Result<DetectResult, String> {
    let mut out = Vec::new();
    for (name, bin) in [("Claude Code", "claude"), ("Codex", "codex")] {
        let path = which::which(bin).ok();
        let installed = path.is_some();
        let mut version: Option<String> = None;
        let mut logged_in = false;
        if let Some(p) = &path {
            // version probe
            if let Ok(o) = Command::new(p).arg("--version").output() {
                if o.status.success() {
                    let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    version = Some(v);
                }
            }
            // login probe — minimal, no cost. We treat presence of CLI config as "logged in".
            // For Claude Code we look for ~/.claude/ directory or settings.
            if bin == "claude" {
                if let Some(home) = dirs_home() {
                    let p1 = home.join(".claude");
                    let p2 = home.join(".config").join("claude");
                    logged_in = p1.exists() || p2.exists();
                }
            } else if bin == "codex" {
                if let Some(home) = dirs_home() {
                    let p1 = home.join(".codex");
                    let p2 = home.join(".config").join("codex");
                    logged_in = p1.exists() || p2.exists();
                }
            }
        }
        out.push(CliInfo {
            name: name.into(),
            binary: bin.into(),
            installed,
            path: path.map(|p| p.to_string_lossy().to_string()),
            version,
            logged_in,
        });
    }
    Ok(DetectResult { clis: out })
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[tauri::command]
pub fn create_topic(
    state: State<'_, AppState>,
    title: String,
    engine: String,
    workdir: String,
    model: Option<String>,
    danger_mode: bool,
) -> Result<Topic, String> {
    let mut db = state.db.lock();
    let t = db
        .create_topic(&title, &engine, &workdir, model.as_deref(), danger_mode)
        .map_err(map_err)?;
    Ok(t)
}

#[tauri::command]
pub fn list_topics(state: State<'_, AppState>) -> Result<Vec<Topic>, String> {
    state.db.lock().list_topics().map_err(map_err)
}

#[tauri::command]
pub fn delete_topic(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine.close(&id);
    state.db.lock().delete_topic(&id).map_err(map_err)
}

#[tauri::command]
pub fn rename_topic(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<(), String> {
    state.db.lock().rename_topic(&id, &title).map_err(map_err)
}

#[tauri::command]
pub fn open_topic(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let topic = state
        .db
        .lock()
        .get_topic(&id)
        .map_err(map_err)?
        .ok_or_else(|| "topic not found".to_string())?;
    let db_handle = Arc::clone(&state.db);
    let topic_id_for_cb = topic.id.clone();
    state
        .engine
        .spawn(
            topic.id.clone(),
            topic.engine.clone(),
            topic.workdir.clone(),
            topic.model.clone(),
            topic.session_id.clone(),
            topic.danger_mode,
            Box::new(move |sid| {
                if let Some(mut db) = db_handle.try_lock() {
                    let _ = db.set_session_id(&topic_id_for_cb, sid);
                }
            }),
        )
        .map_err(map_err)
}

#[tauri::command]
pub fn send_message(
    state: State<'_, AppState>,
    topic_id: String,
    content: String,
) -> Result<Message, String> {
    let saved = state
        .db
        .lock()
        .append_message(&topic_id, "user", &content, None)
        .map_err(map_err)?;
    state.engine.send(&topic_id, &content).map_err(map_err)?;
    Ok(saved)
}

#[tauri::command]
pub fn interrupt_topic(state: State<'_, AppState>, topic_id: String) -> Result<(), String> {
    state.engine.interrupt(&topic_id).map_err(map_err)
}

#[tauri::command]
pub fn approve_permission(
    state: State<'_, AppState>,
    topic_id: String,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    state
        .engine
        .approve(&topic_id, allow, &request_id)
        .map_err(map_err)
}

#[tauri::command]
pub fn list_messages(
    state: State<'_, AppState>,
    topic_id: String,
) -> Result<Vec<Message>, String> {
    state.db.lock().list_messages(&topic_id).map_err(map_err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub fn list_workdir_files(workdir: String) -> Result<Vec<FileEntry>, String> {
    let mut out = Vec::new();
    let dir = std::fs::read_dir(&workdir).map_err(map_err)?;
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: md.is_dir(),
            size: md.len(),
        });
    }
    out.sort_by(|a, b| (b.is_dir.cmp(&a.is_dir)).then(a.name.cmp(&b.name)));
    Ok(out)
}

#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    let md = std::fs::metadata(&path).map_err(map_err)?;
    if md.len() > 2_000_000 {
        return Err("file too large to preview (>2MB)".to_string());
    }
    std::fs::read_to_string(&path).map_err(map_err)
}

#[tauri::command]
pub fn set_danger_mode(
    state: State<'_, AppState>,
    id: String,
    danger: bool,
) -> Result<(), String> {
    state.db.lock().set_danger_mode(&id, danger).map_err(map_err)
}

#[tauri::command]
pub fn running_topics(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(state.engine.running_ids())
}

#[tauri::command]
pub fn debug_log(message: String) {
    eprintln!("[fe] {message}");
}
