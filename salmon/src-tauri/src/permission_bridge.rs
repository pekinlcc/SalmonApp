//! Local HTTP bridge that fields PreToolUse hook callbacks from `claude`
//! and surfaces them as Tauri events for the React UI to render as
//! PermissionCards. The user's click is then routed back through the
//! still-open HTTP connection so Claude can proceed with its tool call.
//!
//! Why PreToolUse and not PermissionRequest
//! ----------------------------------------
//! v0.5.1 originally hooked `PermissionRequest`, which sounded right by
//! name but doesn't fire in `-p` non-interactive mode — its semantic is
//! "before the permission prompt is shown to the user", and there is
//! no prompt to be before when there's no TTY. `PreToolUse` is the one
//! that actually fires for every tool invocation regardless of mode and
//! that accepts a `permissionDecision` response shape. Confirmed by
//! probe-server experiment in May 2026:
//!
//! ```text
//! PreToolUse hook called for tool=WebFetch → return "allow" →
//! fetch goes through, no permission_denial recorded.
//! ```
//!
//! Matcher
//! -------
//! PreToolUse fires for *every* tool, including `Read`/`Glob`/`Grep`
//! that don't normally need permission. Showing a card for those would
//! be noise. We constrain via `matcher` regex to the set Claude Code
//! itself prompts for in interactive mode:
//!
//! ```text
//! ^(Bash|Edit|Write|MultiEdit|NotebookEdit|
//!   WebFetch|WebSearch|Task|mcp__.+)$
//! ```
//!
//! Allowlist short-circuit
//! -----------------------
//! Even with the matcher, naive UI-on-everything would re-prompt for
//! tools the user has already added to `~/.claude/settings.json`'s
//! `permissions.allow`. Before emitting UI we read that file and check
//! whether the bare tool name is allowlisted. Constrained rules
//! (`"Bash(npm *)"`) we don't try to evaluate — those still pop a card,
//! one extra click but functionally correct.
//!
//! Lifecycle
//! ---------
//! The bridge runs for the entire app lifetime; no per-topic teardown.
//! Pending requests whose Claude child gets killed (interrupt, topic
//! delete) just leak a oneshot until either (a) the user later clicks
//! the now-stale card, or (b) the app exits. Both are bounded.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

type Pending = HashMap<String, oneshot::Sender<bool>>;

#[derive(Clone)]
pub struct PermissionBridge {
    pub port: u16,
    /// Per-session secret embedded in the hook URL path. A `claude` child
    /// only learns it via the inline-settings JSON we hand it at spawn, so
    /// any OTHER local process (browser extension, malware) that tries to
    /// POST to the permission endpoint can't guess this 128-bit value and
    /// gets a 403 — closing the local-privilege-escalation hole where an
    /// attacker could auto-approve dangerous Bash/WebFetch tool calls.
    secret: String,
    app: AppHandle,
    pending: Arc<Mutex<Pending>>,
}

impl PermissionBridge {
    /// Bind the HTTP server on a random localhost port and spawn its
    /// run loop on the Tauri async runtime. Returns the bridge handle
    /// (cheap-clone, contains an `Arc`) ready to be stored in `AppState`.
    pub async fn start(app: AppHandle) -> anyhow::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let secret = uuid::Uuid::new_v4().to_string();
        let pending: Arc<Mutex<Pending>> = Arc::new(Mutex::new(HashMap::new()));
        let bridge = Self {
            port,
            secret,
            app: app.clone(),
            pending: pending.clone(),
        };

        // Secret is a path segment, not just a query param, so it can't be
        // accidentally logged by a reverse proxy that strips queries — and
        // the route won't even match without it (404 vs 403, both rejected).
        let router = Router::new()
            .route("/permission/:secret/:topic_id", post(handle_permission))
            .with_state(bridge.clone());

        eprintln!(
            "[salmon] permission bridge listening on http://127.0.0.1:{port}/permission/<topic_id>"
        );

        tauri::async_runtime::spawn(async move {
            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("[salmon] permission bridge server died: {e}");
            }
        });

        Ok(bridge)
    }

    /// Resolve a pending permission request. Returns `true` if a
    /// matching pending request was found and dispatched, `false`
    /// otherwise (stale request, double-click, etc.).
    pub fn answer(&self, request_id: &str, allow: bool) -> bool {
        let mut p = self.pending.lock();
        match p.remove(request_id) {
            Some(tx) => {
                let _ = tx.send(allow);
                true
            }
            None => false,
        }
    }

    /// Build the inline JSON to pass to `claude --settings <…>` so the
    /// spawned child routes its PreToolUse events at us. Per-topic URL
    /// lets us scope the eventual UI emission to the right Topic (which
    /// can otherwise have several spawns in flight).
    pub fn settings_json_for_topic(&self, topic_id: &str) -> String {
        json!({
            "hooks": {
                "PreToolUse": [{
                    // Anchored regex covering the tools Claude Code itself
                    // would prompt for in interactive mode. Read/Glob/Grep
                    // and other no-permission-needed tools don't match,
                    // so they don't fire our hook at all.
                    "matcher": "^(Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|WebSearch|Task|mcp__.+)$",
                    "hooks": [{
                        "type": "http",
                        "url": format!("http://127.0.0.1:{}/permission/{}/{}", self.port, self.secret, topic_id),
                        "timeout": 600,
                    }]
                }]
            }
        })
        .to_string()
    }
}

/// Read the user's `~/.claude/settings.json` and return the set of bare
/// tool names that are unconditionally allowlisted (e.g. `"WebSearch"`).
/// Constrained rules like `"Bash(npm *)"` are skipped — we don't
/// duplicate Claude's pattern matcher; those flow through the UI path.
fn read_allowlisted_tools() -> HashSet<String> {
    let home = match std::env::var_os("HOME").map(PathBuf::from) {
        Some(h) => h,
        None => return HashSet::new(),
    };
    let path = home.join(".claude").join("settings.json");
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return HashSet::new(),
    };
    let v: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return HashSet::new(),
    };
    let arr = match v
        .get("permissions")
        .and_then(|p| p.get("allow"))
        .and_then(|a| a.as_array())
    {
        Some(a) => a,
        None => return HashSet::new(),
    };
    arr.iter()
        .filter_map(|x| x.as_str())
        .filter(|s| !s.contains('('))
        .map(|s| s.to_string())
        .collect()
}

async fn handle_permission(
    State(bridge): State<PermissionBridge>,
    Path((secret, topic_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    // Reject anything that doesn't present the per-session secret. A
    // constant-time-ish compare isn't worth it here — the value is a v4
    // UUID (122 random bits), brute force over a localhost socket is not
    // a realistic threat, and timing oracles on a string eq of equal-length
    // UUIDs give negligible signal.
    if secret != bridge.secret {
        eprintln!(
            "[salmon] permission bridge: rejected request with bad secret (topic={topic_id})"
        );
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden" })));
    }
    let tool_name = body
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool_input = body.get("tool_input").cloned().unwrap_or(json!({}));
    // For Bash specifically, the user cares about the actual shell command,
    // not the JSON object — surface it separately so the card can render
    // it prominently.
    let command = tool_input
        .get("command")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());

    // Allowlist short-circuit: if the user has already added this exact
    // tool name to ~/.claude/settings.json, auto-allow without bothering
    // the UI. Re-read on every request so edits to settings.json apply
    // without restart.
    if read_allowlisted_tools().contains(&tool_name) {
        eprintln!(
            "[salmon] PreToolUse topic={topic_id} tool={tool_name} → auto-allow (in ~/.claude/settings.json)"
        );
        return (
            StatusCode::OK,
            Json(allow_response("user settings.json allowlist")),
        );
    }

    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<bool>();
    bridge.pending.lock().insert(request_id.clone(), tx);

    eprintln!(
        "[salmon] PreToolUse topic={topic_id} tool={tool_name} request_id={request_id} → ask user"
    );

    // The frontend listens on this Tauri event and stuffs it into
    // `pendingPermByTopic[topicId]`, which `<ChatStream>` renders as a
    // `<PermissionCard>`. The shape here matches the `permissionRequest`
    // variant of `StreamEvent` in src/lib/types.ts.
    let _ = bridge.app.emit(
        "salmon-stream",
        json!({
            "kind": "permissionRequest",
            "topicId": topic_id,
            "requestId": request_id,
            "tool": tool_name,
            "input": tool_input,
            "command": command,
        }),
    );

    // Block this connection until the user clicks Allow / Deny in the UI
    // (or until `claude`'s configured 600 s timeout fires — it will close
    // the socket from its end, axum will drop the response, oneshot will
    // be discarded by Drop).
    let allow = rx.await.unwrap_or(false);

    eprintln!(
        "[salmon] permission resolved request_id={request_id} decision={}",
        if allow { "allow" } else { "deny" }
    );
    let resp = if allow {
        allow_response("SalmonApp UI")
    } else {
        json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "SalmonApp UI",
            }
        })
    };
    (StatusCode::OK, Json(resp))
}

fn allow_response(reason: &str) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": reason,
        }
    })
}
