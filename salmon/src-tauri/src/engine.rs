use crate::permission_bridge::PermissionBridge;
use crate::types::{StreamEvent, ToolCall};
use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use serde_json::json;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

/// Per-topic running engine instance.
pub struct Session {
    pub topic_id: String,
    pub workdir: String,
    pub engine_kind: String,
    pub stdin_tx: mpsc::UnboundedSender<EngineCmd>,
}

pub enum EngineCmd {
    Send(String),       // user prompt text
    Approve(bool, String), // approve(allow, request_id)
    Interrupt,
    Shutdown,
}

pub struct EngineRegistry {
    app: AppHandle,
    inner: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    bridge: PermissionBridge,
}

impl EngineRegistry {
    pub fn new(app: AppHandle, bridge: PermissionBridge) -> Self {
        Self {
            app,
            inner: Arc::new(Mutex::new(HashMap::new())),
            bridge,
        }
    }

    pub fn is_running(&self, topic_id: &str) -> bool {
        self.inner.lock().contains_key(topic_id)
    }

    pub fn running_ids(&self) -> Vec<String> {
        self.inner.lock().keys().cloned().collect()
    }

    pub fn close(&self, topic_id: &str) {
        if let Some(sess) = self.inner.lock().remove(topic_id) {
            let _ = sess.stdin_tx.send(EngineCmd::Shutdown);
        }
    }

    pub fn send(&self, topic_id: &str, prompt: &str) -> Result<()> {
        let sess = self
            .inner
            .lock()
            .get(topic_id)
            .cloned()
            .ok_or_else(|| anyhow!("topic not running"))?;
        sess.stdin_tx
            .send(EngineCmd::Send(prompt.to_string()))
            .map_err(|_| anyhow!("send failed"))?;
        Ok(())
    }

    pub fn interrupt(&self, topic_id: &str) -> Result<()> {
        if let Some(sess) = self.inner.lock().get(topic_id).cloned() {
            sess.stdin_tx.send(EngineCmd::Interrupt).ok();
        }
        Ok(())
    }

    pub fn approve(&self, topic_id: &str, allow: bool, request_id: &str) -> Result<()> {
        if let Some(sess) = self.inner.lock().get(topic_id).cloned() {
            sess.stdin_tx
                .send(EngineCmd::Approve(allow, request_id.to_string()))
                .ok();
        }
        Ok(())
    }

    /// Lazily spawn a CLI subprocess for a topic. Returns Ok if either newly spawned
    /// or already running.
    pub fn spawn(
        &self,
        topic_id: String,
        engine_kind: String,
        workdir: String,
        model: Option<String>,
        session_id: Option<String>,
        danger_mode: bool,
        on_session_id: Box<dyn Fn(&str) + Send + Sync>,
        on_assistant_message: Box<dyn Fn(&str) + Send + Sync>,
    ) -> Result<()> {
        if self.is_running(&topic_id) {
            return Ok(());
        }

        let app = self.app.clone();
        let registry = self.inner.clone();
        let bridge = self.bridge.clone();
        let (tx, mut rx) = mpsc::unbounded_channel::<EngineCmd>();

        let topic_id_for_task = topic_id.clone();
        let kind = engine_kind.clone();
        let workdir_clone = workdir.clone();

        eprintln!("[salmon] spawn task for topic={} engine={} workdir={}", topic_id_for_task, kind, workdir_clone);

        tauri::async_runtime::spawn(async move {
            eprintln!("[salmon] task entered for topic={}", topic_id_for_task);
            let result = run_session(
                app.clone(),
                topic_id_for_task.clone(),
                kind,
                workdir_clone,
                model,
                session_id,
                danger_mode,
                bridge,
                &mut rx,
                on_session_id,
                on_assistant_message,
            )
            .await;
            eprintln!("[salmon] task exited for topic={} result={:?}", topic_id_for_task, result.is_err());
            if let Err(e) = result {
                let _ = app.emit(
                    "salmon-stream",
                    StreamEvent::Error {
                        topic_id: topic_id_for_task.clone(),
                        message: format!("engine error: {e}"),
                    },
                );
            }
            let _ = app.emit(
                "salmon-stream",
                StreamEvent::Exited {
                    topic_id: topic_id_for_task.clone(),
                    code: None,
                },
            );
            registry.lock().remove(&topic_id_for_task);
        });

        let session = Session {
            topic_id: topic_id.clone(),
            workdir,
            engine_kind,
            stdin_tx: tx,
        };
        self.inner.lock().insert(topic_id, Arc::new(session));
        Ok(())
    }
}

async fn run_session(
    app: AppHandle,
    topic_id: String,
    engine_kind: String,
    workdir: String,
    model: Option<String>,
    session_id: Option<String>,
    danger_mode: bool,
    bridge: PermissionBridge,
    rx: &mut mpsc::UnboundedReceiver<EngineCmd>,
    on_session_id: Box<dyn Fn(&str) + Send + Sync>,
    on_assistant_message: Box<dyn Fn(&str) + Send + Sync>,
) -> Result<()> {
    let on_assistant = std::sync::Arc::new(on_assistant_message);
    if engine_kind != "claude" && engine_kind != "codex" {
        let _ = app.emit(
            "salmon-stream",
            StreamEvent::Error {
                topic_id: topic_id.clone(),
                message: format!("engine '{}' not yet supported in this build", engine_kind),
            },
        );
        return Ok(());
    }

    let _ = app.emit(
        "salmon-stream",
        StreamEvent::Started {
            topic_id: topic_id.clone(),
            session_id: session_id.clone(),
        },
    );

    // Drain commands as they come in. We use a per-prompt subprocess model:
    // each user message spawns `claude -p --resume <sid>` (or initial spawn without --resume),
    // and we pipe stream-json output back.
    let mut current_session_id: Option<String> = session_id;

    while let Some(cmd) = rx.recv().await {
        eprintln!("[salmon] run_session received cmd for topic={}", topic_id);
        match cmd {
            EngineCmd::Shutdown => break,
            EngineCmd::Interrupt => {
                // Nothing running between prompts; ignore.
            }
            EngineCmd::Approve(_, _) => {
                // In stream-json mode permission flow is mediated by the harness;
                // for MVP we don't block on approvals — danger_mode passes a flag at spawn,
                // otherwise default permissions apply. Future: use --permission-prompt-tool.
            }
            EngineCmd::Send(prompt) => {
                eprintln!("[salmon] Send arm entered; prompt len={} engine={}", prompt.len(), engine_kind);

                // Up-front workdir check — both CLIs need a real cwd, and the error
                // they emit when it's missing is unhelpful ("exited with status 2").
                let wd = std::path::Path::new(&workdir);
                if !wd.exists() || !wd.is_dir() {
                    let _ = app.emit("salmon-stream", StreamEvent::Error {
                        topic_id: topic_id.clone(),
                        message: format!("工作目录不存在: {}\n\n该 Topic 已不可发消息;在右上 Topic 菜单选\"归档\"或\"删除\"。", workdir),
                    });
                    let _ = app.emit("salmon-stream", StreamEvent::Exited {
                        topic_id: topic_id.clone(),
                        code: Some(2),
                    });
                    continue;
                }

                // Build the per-engine command.
                let bin_name = engine_kind.as_str();
                let bin = match which::which(bin_name) {
                    Ok(p) => p,
                    Err(e) => {
                        let _ = app.emit("salmon-stream", StreamEvent::Error {
                            topic_id: topic_id.clone(),
                            message: format!("{} binary not found in PATH: {}", bin_name, e),
                        });
                        let _ = app.emit("salmon-stream", StreamEvent::Exited {
                            topic_id: topic_id.clone(), code: Some(127),
                        });
                        continue;
                    }
                };

                let mut cmd_builder = Command::new(&bin);
                cmd_builder.current_dir(&workdir);
                if engine_kind == "claude" {
                    cmd_builder
                        .arg("-p")
                        .arg("--output-format").arg("stream-json")
                        .arg("--verbose")
                        .arg(&prompt);
                    if let Some(sid) = &current_session_id {
                        cmd_builder.arg("--resume").arg(sid);
                    }
                    if let Some(m) = &model {
                        cmd_builder.arg("--model").arg(m);
                    }
                    if danger_mode {
                        cmd_builder.arg("--dangerously-skip-permissions");
                    } else {
                        // Route Claude's PermissionRequest hook through Salmon's
                        // local HTTP bridge so the user sees a PermissionCard
                        // instead of getting a silent default-deny. `--settings`
                        // ADDS to (not replaces) the user's ~/.claude/settings.json.
                        cmd_builder
                            .arg("--settings")
                            .arg(bridge.settings_json_for_topic(&topic_id));
                    }
                } else {
                    // codex — `--cd` is only valid on `codex exec` (the first call),
                    // not on `codex exec resume`; relying on the spawn's current_dir
                    // covers both cases uniformly.
                    cmd_builder.arg("exec");
                    if let Some(sid) = &current_session_id {
                        cmd_builder.arg("resume").arg(sid);
                    }
                    cmd_builder
                        .arg("--json")
                        .arg("--skip-git-repo-check");
                    if let Some(m) = &model {
                        cmd_builder.arg("-c").arg(format!("model={}", m));
                    }
                    if danger_mode {
                        cmd_builder.arg("--dangerously-bypass-approvals-and-sandbox");
                    }
                    cmd_builder.arg(&prompt);
                }
                cmd_builder
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .kill_on_drop(true);

                eprintln!("[salmon] spawning child {}…", bin_name);
                let mut child = match cmd_builder.spawn() {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = app.emit("salmon-stream", StreamEvent::Error {
                            topic_id: topic_id.clone(),
                            message: format!("spawn {} failed: {}", bin_name, e),
                        });
                        let _ = app.emit("salmon-stream", StreamEvent::Exited {
                            topic_id: topic_id.clone(), code: Some(-1),
                        });
                        continue;
                    }
                };

                let stdout = child.stdout.take().unwrap();
                let stderr = child.stderr.take().unwrap();
                let mut sid_collected: Option<String> = None;
                let mut line_count: u32 = 0;

                let mut stdout_reader = BufReader::new(stdout).lines();
                let mut stderr_reader = BufReader::new(stderr).lines();

                let app_for_loop = app.clone();
                let tid_for_loop = topic_id.clone();
                let kind_for_loop = engine_kind.clone();
                let on_assistant_for_loop = on_assistant.clone();

                let stdout_fut = async {
                    while let Ok(Some(line)) = stdout_reader.next_line().await {
                        if line.trim().is_empty() { continue; }
                        line_count += 1;
                        let _ = app_for_loop.emit("salmon-stream", StreamEvent::Log {
                            topic_id: tid_for_loop.clone(),
                            line: line.clone(),
                        });
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                            if kind_for_loop == "claude" {
                                handle_stream_event(&app_for_loop, &tid_for_loop, &v, &mut sid_collected, &*on_assistant_for_loop);
                            } else {
                                handle_codex_event(&app_for_loop, &tid_for_loop, &v, &mut sid_collected, &*on_assistant_for_loop);
                            }
                        }
                    }
                };

                let app_for_err = app.clone();
                let tid_for_err = topic_id.clone();
                let stderr_fut = async {
                    while let Ok(Some(line)) = stderr_reader.next_line().await {
                        let _ = app_for_err.emit("salmon-stream", StreamEvent::Log {
                            topic_id: tid_for_err.clone(),
                            line: format!("[stderr] {line}"),
                        });
                    }
                };

                let wait_fut = child.wait();
                let (_, _, status) = tokio::join!(stdout_fut, stderr_fut, wait_fut);
                eprintln!("[salmon] {} child wait returned: {:?}, parsed {} lines", bin_name, status, line_count);

                if let Some(sid) = sid_collected {
                    if current_session_id.as_deref() != Some(sid.as_str()) {
                        current_session_id = Some(sid.clone());
                        on_session_id(&sid);
                    }
                }

                let exit_code = match &status {
                    Ok(s) => s.code(),
                    Err(_) => Some(-1),
                };
                if let Ok(s) = &status {
                    if !s.success() {
                        let _ = app.emit("salmon-stream", StreamEvent::Error {
                            topic_id: topic_id.clone(),
                            message: format!("{} exited with status {:?}", bin_name, s.code()),
                        });
                    }
                }
                let _ = app.emit("salmon-stream", StreamEvent::Exited {
                    topic_id: topic_id.clone(), code: exit_code,
                });
            }
        }
    }

    Ok(())
}

/// Parse one Claude Code stream-json event line and emit higher-level events.
fn handle_stream_event(
    app: &AppHandle,
    topic_id: &str,
    v: &serde_json::Value,
    sid_out: &mut Option<String>,
    on_assistant_message: &(dyn Fn(&str) + Send + Sync),
) {
    let kind = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

    // capture session id
    if let Some(sid) = v.get("session_id").and_then(|x| x.as_str()) {
        *sid_out = Some(sid.to_string());
    }

    match kind {
        "system" => {
            if let Some(sub) = v.get("subtype").and_then(|x| x.as_str()) {
                if sub == "init" {
                    if let Some(sid) = v.get("session_id").and_then(|x| x.as_str()) {
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::Started {
                                topic_id: topic_id.to_string(),
                                session_id: Some(sid.to_string()),
                            },
                        );
                    }
                }
            }
        }
        "assistant" => {
            if let Some(msg) = v.get("message") {
                if let Some(content_arr) = msg.get("content").and_then(|c| c.as_array()) {
                    for block in content_arr {
                        let btype = block.get("type").and_then(|x| x.as_str()).unwrap_or("");
                        match btype {
                            "text" => {
                                if let Some(text) = block.get("text").and_then(|x| x.as_str()) {
                                    let mid = msg
                                        .get("id")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let r = app.emit(
                                        "salmon-stream",
                                        StreamEvent::AssistantDone {
                                            topic_id: topic_id.to_string(),
                                            message_id: mid,
                                            content: text.to_string(),
                                        },
                                    );
                                    eprintln!("[salmon] emit AssistantDone len={} result={:?}", text.len(), r.as_ref().map(|_| ()).map_err(|e| e.to_string()));
                                    on_assistant_message(text);
                                }
                            }
                            "tool_use" => {
                                let id = block
                                    .get("id")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let name = block
                                    .get("name")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let input = block.get("input").cloned().unwrap_or(json!({}));
                                let tc = ToolCall {
                                    id,
                                    name,
                                    input,
                                    state: "running".into(),
                                    result: None,
                                };
                                let _ = app.emit(
                                    "salmon-stream",
                                    StreamEvent::ToolCall {
                                        topic_id: topic_id.to_string(),
                                        tool: tc,
                                    },
                                );
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        "user" => {
            // user role here actually carries tool_result blocks back from previous tool_use
            if let Some(msg) = v.get("message") {
                if let Some(content_arr) = msg.get("content").and_then(|c| c.as_array()) {
                    for block in content_arr {
                        if block.get("type").and_then(|x| x.as_str()) == Some("tool_result") {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string();
                            let result = block
                                .get("content")
                                .map(|c| {
                                    if c.is_string() {
                                        c.as_str().unwrap_or("").to_string()
                                    } else {
                                        c.to_string()
                                    }
                                })
                                .unwrap_or_default();
                            let is_error = block
                                .get("is_error")
                                .and_then(|x| x.as_bool())
                                .unwrap_or(false);
                            let _ = app.emit(
                                "salmon-stream",
                                StreamEvent::ToolResult {
                                    topic_id: topic_id.to_string(),
                                    tool_id: tool_use_id,
                                    state: if is_error { "error".into() } else { "done".into() },
                                    result: Some(result),
                                },
                            );
                        }
                    }
                }
            }
        }
        "result" => {
            // final summary; nothing to emit beyond what we already streamed
        }
        _ => {}
    }
}

/// Parse one Codex CLI JSONL event line. Codex emits a small set of types:
/// `thread.started` (carries thread_id, our session id), `turn.started`,
/// `item.completed` (with a typed `item` object — `agent_message` for
/// assistant text, plus various tool-call types), `turn.completed`
/// (with usage). Tool-call surfacing is best-effort: we map any item with
/// a recognizable name + input into a ToolCall card so users can see what
/// codex did, but the schema is less fixed than Claude's stream-json so
/// some items render as plain text fallbacks.
fn handle_codex_event(
    app: &AppHandle,
    topic_id: &str,
    v: &serde_json::Value,
    sid_out: &mut Option<String>,
    on_assistant_message: &(dyn Fn(&str) + Send + Sync),
) {
    let kind = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    match kind {
        "thread.started" => {
            if let Some(tid) = v.get("thread_id").and_then(|x| x.as_str()) {
                *sid_out = Some(tid.to_string());
                let _ = app.emit(
                    "salmon-stream",
                    StreamEvent::Started {
                        topic_id: topic_id.to_string(),
                        session_id: Some(tid.to_string()),
                    },
                );
            }
        }
        "item.completed" | "item.started" => {
            let Some(item) = v.get("item") else { return };
            let itype = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
            let id = item.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
            match itype {
                "agent_message" => {
                    if kind != "item.completed" {
                        return;
                    }
                    if let Some(text) = item.get("text").and_then(|x| x.as_str()) {
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::AssistantDone {
                                topic_id: topic_id.to_string(),
                                message_id: id,
                                content: text.to_string(),
                            },
                        );
                        on_assistant_message(text);
                    }
                }
                "agent_reasoning" | "reasoning" => {
                    // codex's chain-of-thought; surface as a small note when present.
                    if kind != "item.completed" {
                        return;
                    }
                    if let Some(text) = item
                        .get("text")
                        .and_then(|x| x.as_str())
                        .or_else(|| item.get("summary").and_then(|x| x.as_str()))
                    {
                        if !text.trim().is_empty() {
                            let _ = app.emit(
                                "salmon-stream",
                                StreamEvent::AssistantDone {
                                    topic_id: topic_id.to_string(),
                                    message_id: id,
                                    content: format!("> _(reasoning)_ {}", text),
                                },
                            );
                        }
                    }
                }
                // Tool-like events. Map into our ToolCall shape on item.started so
                // the card shows up immediately; flip to done on item.completed.
                _ => {
                    let name = match itype {
                        "command_execution" | "local_shell_call" => "Bash",
                        "file_change" | "file_edit" | "patch_apply" => "Edit",
                        "file_read" => "Read",
                        "web_search" => "WebSearch",
                        "web_fetch" => "WebFetch",
                        other if !other.is_empty() => other,
                        _ => return,
                    };
                    let mut input = item.clone();
                    if let Some(obj) = input.as_object_mut() {
                        obj.remove("id");
                        obj.remove("type");
                    }
                    if kind == "item.started" {
                        let tc = ToolCall {
                            id: id.clone(),
                            name: name.to_string(),
                            input,
                            state: "running".into(),
                            result: None,
                        };
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::ToolCall {
                                topic_id: topic_id.to_string(),
                                tool: tc,
                            },
                        );
                    } else {
                        // completed
                        let result = item
                            .get("output")
                            .map(|c| {
                                if c.is_string() {
                                    c.as_str().unwrap_or("").to_string()
                                } else {
                                    c.to_string()
                                }
                            })
                            .or_else(|| {
                                item.get("text")
                                    .and_then(|x| x.as_str())
                                    .map(|s| s.to_string())
                            });
                        let exit_status = item
                            .get("exit_code")
                            .and_then(|x| x.as_i64())
                            .unwrap_or(0);
                        let state = if exit_status != 0 { "error" } else { "done" };
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::ToolResult {
                                topic_id: topic_id.to_string(),
                                tool_id: id,
                                state: state.into(),
                                result,
                            },
                        );
                    }
                }
            }
        }
        "turn.started" | "turn.completed" => {
            // Could be used for usage display; ignored for MVP.
        }
        _ => {}
    }
}

// stdin sender helper (reserved for future interactive mode)
#[allow(dead_code)]
async fn write_line(stdin: &mut ChildStdin, line: &str) -> Result<()> {
    stdin.write_all(line.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

#[allow(dead_code)]
fn _unused_child(_c: Child) {}
