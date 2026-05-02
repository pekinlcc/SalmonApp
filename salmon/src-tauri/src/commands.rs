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
pub fn suggest_topic_title(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let topic = state
        .db
        .lock()
        .get_topic(&id)
        .map_err(map_err)?
        .ok_or("topic not found")?;
    let msgs = state.db.lock().list_messages(&id).map_err(map_err)?;
    let first_user = msgs
        .iter()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .ok_or("no user message yet")?;
    let first_asst = msgs
        .iter()
        .find(|m| m.role == "assistant")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    let user_snip = truncate_chars(&first_user, 240);
    let asst_snip = truncate_chars(&first_asst, 320);
    let prompt = format!(
        "请为下面这段对话生成一个 2 到 6 个字的中文标题,直接输出标题文字本身,不要引号、句号、解释或前后缀。\n\n用户: {}\n助手: {}",
        user_snip, asst_snip
    );

    let bin_name = match topic.engine.as_str() {
        "codex" => "codex",
        _ => "claude",
    };
    let bin = which::which(bin_name).map_err(|e| format!("{}: {}", bin_name, e))?;

    let mut cmd = Command::new(&bin);
    cmd.arg("-p")
        .arg(&prompt)
        .current_dir(&topic.workdir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(m) = topic.model.as_deref() {
        cmd.arg("--model").arg(m);
    }

    let out = cmd.output().map_err(map_err)?;
    if !out.status.success() {
        return Err(format!(
            "{} 退出 {:?}: {}",
            bin_name,
            out.status.code(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let raw = String::from_utf8_lossy(&out.stdout).to_string();
    let title = clean_title(&raw);
    if title.is_empty() {
        return Err("生成的标题为空".into());
    }
    state
        .db
        .lock()
        .rename_topic(&id, &title)
        .map_err(map_err)?;
    Ok(title)
}

fn truncate_chars(s: &str, n: usize) -> String {
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i >= n {
            out.push('…');
            break;
        }
        out.push(c);
    }
    out
}

fn clean_title(raw: &str) -> String {
    let s = raw.trim();
    let line = s.lines().last().unwrap_or(s).trim();
    let trimmed: String = line
        .trim_matches(|c: char| {
            c == '"' || c == '\'' || c == '“' || c == '”' || c == '《' || c == '》' || c == '「' || c == '」'
        })
        .chars()
        .take(20)
        .collect();
    trimmed.trim().to_string()
}

#[tauri::command]
pub fn render_office_preview(path: String) -> Result<Vec<String>, String> {
    use base64::Engine;
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let pin = PathBuf::from(&path);
    if !pin.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    let md = std::fs::metadata(&pin).map_err(map_err)?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    let key = format!("{:016x}-{}", h.finish(), mtime);

    let cache_root = if let Ok(x) = std::env::var("XDG_CACHE_HOME") {
        PathBuf::from(x)
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".cache")
    } else {
        std::env::temp_dir()
    }
    .join("salmon")
    .join("preview");
    let dir = cache_root.join(&key);

    let need_render = !dir.is_dir()
        || std::fs::read_dir(&dir)
            .map(|mut d| d.next().is_none())
            .unwrap_or(true);

    if need_render {
        std::fs::create_dir_all(&dir).map_err(map_err)?;
        let profile_dir = dir.join(".lo-profile");
        std::fs::create_dir_all(&profile_dir).map_err(map_err)?;
        let profile_url = format!("file://{}", profile_dir.display());

        let soffice_out = Command::new("soffice")
            .args([
                "--headless",
                "--norestore",
                "--nolockcheck",
                "--nodefault",
            ])
            .arg(format!("-env:UserInstallation={}", profile_url))
            .arg("--convert-to")
            .arg("pdf")
            .arg("--outdir")
            .arg(&dir)
            .arg(&pin)
            .output();
        let soffice_out = match soffice_out {
            Ok(o) => o,
            Err(e) => {
                return Err(format!(
                    "无法运行 soffice: {}。请先安装 LibreOffice (sudo apt install libreoffice-impress)",
                    e
                ));
            }
        };
        if !soffice_out.status.success() {
            return Err(format!(
                "soffice 转换失败: {}",
                String::from_utf8_lossy(&soffice_out.stderr).trim()
            ));
        }

        let stem = pin
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("out")
            .to_string();
        let pdf_path = dir.join(format!("{}.pdf", stem));
        if !pdf_path.exists() {
            return Err("LibreOffice 未生成 PDF".to_string());
        }

        let prefix = dir.join("slide");
        let pdftoppm_out = Command::new("pdftoppm")
            .args(["-r", "110", "-png"])
            .arg(&pdf_path)
            .arg(&prefix)
            .output()
            .map_err(|e| format!("pdftoppm 不可用: {}", e))?;
        if !pdftoppm_out.status.success() {
            return Err(format!(
                "pdftoppm 失败: {}",
                String::from_utf8_lossy(&pdftoppm_out.stderr).trim()
            ));
        }
        let _ = std::fs::remove_file(&pdf_path);
        let _ = std::fs::remove_dir_all(&profile_dir);
    }

    let mut pngs: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(map_err)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("png"))
        .collect();
    pngs.sort();

    if pngs.is_empty() {
        return Err("未生成任何幻灯片图片".to_string());
    }

    let mut out = Vec::with_capacity(pngs.len());
    for p in pngs.iter().take(200) {
        let bytes = std::fs::read(p).map_err(map_err)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        out.push(format!("data:image/png;base64,{}", b64));
    }
    Ok(out)
}

#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    let md = std::fs::metadata(&path).map_err(map_err)?;
    let size = md.len();
    if size > 2_000_000 {
        return Ok(format!(
            "[文件过大]\n{}\n大小: {}\n（>2MB,不支持预览）",
            path,
            human_size(size)
        ));
    }
    let bytes = std::fs::read(&path).map_err(map_err)?;
    if let Ok(s) = std::str::from_utf8(&bytes) {
        return Ok(s.to_string());
    }
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if let Some(text) = extract_office_text(&ext, &bytes) {
        return Ok(text);
    }
    Ok(binary_placeholder(&path, &bytes, size))
}

fn extract_office_text(ext: &str, bytes: &[u8]) -> Option<String> {
    match ext {
        "pptx" => extract_pptx(bytes),
        "docx" => extract_docx(bytes),
        "xlsx" => extract_xlsx(bytes),
        _ => None,
    }
}

fn open_zip(bytes: &[u8]) -> Option<zip::ZipArchive<std::io::Cursor<&[u8]>>> {
    zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()
}

fn read_entry(z: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>, name: &str) -> Option<String> {
    use std::io::Read;
    let mut f = z.by_name(name).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s)
}

fn extract_pptx(bytes: &[u8]) -> Option<String> {
    let mut z = open_zip(bytes)?;
    let mut slides: Vec<(u32, String)> = Vec::new();
    for i in 0..z.len() {
        let name = z.by_index(i).ok()?.name().to_string();
        if let Some(rest) = name.strip_prefix("ppt/slides/slide") {
            if let Some(num_str) = rest.strip_suffix(".xml") {
                if let Ok(num) = num_str.parse::<u32>() {
                    if let Some(xml) = read_entry(&mut z, &name) {
                        slides.push((num, xml));
                    }
                }
            }
        }
    }
    if slides.is_empty() {
        return None;
    }
    slides.sort_by_key(|(n, _)| *n);
    let mut out = String::new();
    for (n, xml) in &slides {
        out.push_str(&format!("=== 第 {} 张 ===\n", n));
        let texts = collect_tag_text(xml, "a:t");
        if texts.is_empty() {
            out.push_str("(无文本)\n");
        } else {
            for t in texts {
                out.push_str(&t);
                out.push('\n');
            }
        }
        out.push('\n');
    }
    Some(out)
}

fn extract_docx(bytes: &[u8]) -> Option<String> {
    let mut z = open_zip(bytes)?;
    let xml = read_entry(&mut z, "word/document.xml")?;
    let paras = split_by_tag(&xml, "w:p");
    let mut out = String::new();
    for p in paras {
        let texts = collect_tag_text(&p, "w:t");
        if !texts.is_empty() {
            out.push_str(&texts.join(""));
            out.push('\n');
        } else if p.contains("<w:p ") || p.starts_with("<w:p>") {
            out.push('\n');
        }
    }
    Some(out)
}

fn extract_xlsx(bytes: &[u8]) -> Option<String> {
    let mut z = open_zip(bytes)?;
    let mut shared: Vec<String> = Vec::new();
    if let Some(xml) = read_entry(&mut z, "xl/sharedStrings.xml") {
        for si in split_by_tag(&xml, "si") {
            shared.push(collect_tag_text(&si, "t").join(""));
        }
    }
    let mut sheet_names: Vec<String> = Vec::new();
    for i in 0..z.len() {
        let name = z.by_index(i).ok()?.name().to_string();
        if name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml") {
            sheet_names.push(name);
        }
    }
    sheet_names.sort();
    let mut out = String::new();
    for name in &sheet_names {
        out.push_str(&format!("=== {} ===\n", name));
        let xml = match read_entry(&mut z, name) {
            Some(x) => x,
            None => continue,
        };
        for row in split_by_tag(&xml, "row") {
            let mut cells: Vec<String> = Vec::new();
            for c in split_by_tag(&row, "c") {
                let is_shared = c.contains("t=\"s\"");
                let v = collect_tag_text(&c, "v").join("");
                let inline = collect_tag_text(&c, "t").join("");
                let value = if is_shared {
                    v.trim()
                        .parse::<usize>()
                        .ok()
                        .and_then(|i| shared.get(i).cloned())
                        .unwrap_or_default()
                } else if !v.is_empty() {
                    v
                } else {
                    inline
                };
                cells.push(value);
            }
            if cells.iter().any(|s| !s.is_empty()) {
                out.push_str(&cells.join("\t"));
                out.push('\n');
            }
        }
        out.push('\n');
    }
    Some(out)
}

fn split_by_tag(xml: &str, tag: &str) -> Vec<String> {
    let open_prefix = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while let Some(s) = xml[i..].find(&open_prefix) {
        let start = i + s;
        let after = &xml[start + open_prefix.len()..];
        let next_byte = after.as_bytes().first().copied();
        if next_byte != Some(b' ') && next_byte != Some(b'>') && next_byte != Some(b'/') {
            i = start + open_prefix.len();
            continue;
        }
        if let Some(self_close_end) = after.find("/>") {
            if let Some(open_end) = after.find('>') {
                if self_close_end < open_end || self_close_end + 1 == open_end {
                    out.push(xml[start..start + open_prefix.len() + self_close_end + 2].to_string());
                    i = start + open_prefix.len() + self_close_end + 2;
                    continue;
                }
            }
        }
        if let Some(e) = xml[start..].find(&close) {
            let end = start + e + close.len();
            out.push(xml[start..end].to_string());
            i = end;
        } else {
            break;
        }
    }
    out
}

fn collect_tag_text(xml: &str, tag: &str) -> Vec<String> {
    let open_with_ws = format!("<{} ", tag);
    let open_plain = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < xml.len() {
        let p1 = xml[i..].find(&open_with_ws).map(|x| x + i);
        let p2 = xml[i..].find(&open_plain).map(|x| x + i);
        let start = match (p1, p2) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            _ => break,
        };
        let after_lt = &xml[start..];
        let gt = match after_lt.find('>') {
            Some(g) => g,
            None => break,
        };
        let content_start = start + gt + 1;
        if after_lt[..gt].ends_with('/') {
            i = content_start;
            continue;
        }
        let content_end = match xml[content_start..].find(&close) {
            Some(e) => content_start + e,
            None => break,
        };
        out.push(xml_unescape(&xml[content_start..content_end]));
        i = content_end + close.len();
    }
    out
}

fn xml_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn human_size(n: u64) -> String {
    if n < 1024 {
        format!("{} B", n)
    } else if n < 1024 * 1024 {
        format!("{:.1} KB", n as f64 / 1024.0)
    } else {
        format!("{:.1} MB", n as f64 / (1024.0 * 1024.0))
    }
}

fn binary_placeholder(path: &str, bytes: &[u8], size: u64) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = match ext.as_str() {
        "pptx" => "Microsoft PowerPoint (Office Open XML, ZIP 容器)",
        "docx" => "Microsoft Word (Office Open XML, ZIP 容器)",
        "xlsx" => "Microsoft Excel (Office Open XML, ZIP 容器)",
        "ppt" | "doc" | "xls" => "Microsoft Office (旧版 OLE 二进制)",
        "pdf" => "PDF 文档",
        "zip" | "jar" | "apk" => "ZIP 归档",
        "tar" | "gz" | "bz2" | "xz" | "zst" | "7z" => "压缩归档",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tiff" => "图片",
        "mp3" | "wav" | "flac" | "ogg" | "m4a" => "音频",
        "mp4" | "mkv" | "mov" | "webm" | "avi" => "视频",
        "ttf" | "otf" | "woff" | "woff2" => "字体",
        "so" | "dll" | "dylib" | "exe" | "bin" | "o" | "a" | "rlib" => "可执行/库",
        "" => "二进制文件",
        _ => "二进制文件",
    };
    let mut head_hex = String::new();
    for b in bytes.iter().take(16) {
        head_hex.push_str(&format!("{:02X} ", b));
    }
    format!(
        "[无法以文本预览]\n\n类型: {}\n后缀: .{}\n大小: {}\n开头字节: {}\n\n（这是二进制文件,Salmon 暂不支持渲染。要查看内容请用对应应用打开。）",
        kind,
        if ext.is_empty() { "(无)" } else { ext.as_str() },
        human_size(size),
        head_hex.trim()
    )
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
