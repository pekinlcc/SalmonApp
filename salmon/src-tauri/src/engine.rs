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
}

impl EngineRegistry {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            inner: Arc::new(Mutex::new(HashMap::new())),
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
    ) -> Result<()> {
        if self.is_running(&topic_id) {
            return Ok(());
        }

        let app = self.app.clone();
        let registry = self.inner.clone();
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
                &mut rx,
                on_session_id,
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
    rx: &mut mpsc::UnboundedReceiver<EngineCmd>,
    on_session_id: Box<dyn Fn(&str) + Send + Sync>,
) -> Result<()> {
    // For MVP we focus on Claude Code. Codex can be added later with a different driver.
    if engine_kind != "claude" {
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
                eprintln!("[salmon] Send arm entered; prompt len={}", prompt.len());
                let claude_bin = match which::which("claude") {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("[salmon] which::which(claude) failed: {e}");
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::Error {
                                topic_id: topic_id.clone(),
                                message: format!("claude binary not found in PATH: {e}"),
                            },
                        );
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::Exited {
                                topic_id: topic_id.clone(),
                                code: Some(127),
                            },
                        );
                        continue;
                    }
                };
                eprintln!("[salmon] using claude binary: {}", claude_bin.display());

                let mut cmd_builder = Command::new(&claude_bin);
                cmd_builder
                    .arg("-p")
                    .arg("--output-format").arg("stream-json")
                    .arg("--verbose")
                    .arg(&prompt)
                    .current_dir(&workdir)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .kill_on_drop(true);

                if let Some(sid) = &current_session_id {
                    cmd_builder.arg("--resume").arg(sid);
                }
                if let Some(m) = &model {
                    cmd_builder.arg("--model").arg(m);
                }
                if danger_mode {
                    cmd_builder.arg("--dangerously-skip-permissions");
                }

                eprintln!("[salmon] spawning child claude…");
                let mut child = match cmd_builder.spawn() {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[salmon] spawn failed: {e}");
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::Error {
                                topic_id: topic_id.clone(),
                                message: format!("spawn claude failed: {e}"),
                            },
                        );
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::Exited {
                                topic_id: topic_id.clone(),
                                code: Some(-1),
                            },
                        );
                        continue;
                    }
                };
                eprintln!("[salmon] child spawned, pid={:?}", child.id());

                let stdout = child.stdout.take().unwrap();
                let stderr = child.stderr.take().unwrap();

                let mut sid_collected: Option<String> = None;
                let mut line_count: u32 = 0;

                // Read stdout, stderr and child wait concurrently and inline
                // (avoid relying on tokio::spawn from inside a tauri::async_runtime task).
                let mut stdout_reader = BufReader::new(stdout).lines();
                let mut stderr_reader = BufReader::new(stderr).lines();

                let app_for_loop = app.clone();
                let tid_for_loop = topic_id.clone();

                let stdout_fut = async {
                    while let Ok(Some(line)) = stdout_reader.next_line().await {
                        if line.trim().is_empty() { continue; }
                        line_count += 1;
                        eprintln!("[salmon] stdout line: {}", &line.chars().take(140).collect::<String>());
                        let _ = app_for_loop.emit(
                            "salmon-stream",
                            StreamEvent::Log {
                                topic_id: tid_for_loop.clone(),
                                line: line.clone(),
                            },
                        );
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                            handle_stream_event(&app_for_loop, &tid_for_loop, &v, &mut sid_collected);
                        }
                    }
                };

                let app_for_err = app.clone();
                let tid_for_err = topic_id.clone();
                let stderr_fut = async {
                    while let Ok(Some(line)) = stderr_reader.next_line().await {
                        eprintln!("[salmon] stderr line: {}", &line);
                        let _ = app_for_err.emit(
                            "salmon-stream",
                            StreamEvent::Log {
                                topic_id: tid_for_err.clone(),
                                line: format!("[stderr] {line}"),
                            },
                        );
                    }
                };

                let wait_fut = child.wait();
                let (_, _, status) = tokio::join!(stdout_fut, stderr_fut, wait_fut);
                eprintln!("[salmon] child wait returned: {:?}, parsed {} lines", status, line_count);
                let collected_sid = sid_collected;

                if let Some(sid) = collected_sid {
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
                        let _ = app.emit(
                            "salmon-stream",
                            StreamEvent::Error {
                                topic_id: topic_id.clone(),
                                message: format!("claude exited with status {:?}", s.code()),
                            },
                        );
                    }
                }
                // Per-turn done event so frontend can clear "处理中"
                let _ = app.emit(
                    "salmon-stream",
                    StreamEvent::Exited {
                        topic_id: topic_id.clone(),
                        code: exit_code,
                    },
                );
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
