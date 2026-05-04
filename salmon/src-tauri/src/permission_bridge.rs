//! Local HTTP bridge that fields PermissionRequest hook callbacks from
//! `claude` and surfaces them as Tauri events for the React UI to render
//! as PermissionCards. The user's click is then routed back through the
//! still-open HTTP connection so Claude can proceed with its tool call.
//!
//! Design notes
//! ------------
//! `claude --print --output-format stream-json …` runs non-interactively
//! and has no terminal to prompt on, so anything not pre-allowlisted just
//! gets denied silently — that's the gap this module closes. We mirror
//! the long-poll-style HTTP hook pattern that's already established by
//! existing tools (e.g. hermitflow's `http://127.0.0.1:46821/permission/…`):
//!
//!   1. Salmon starts and binds an `axum` router on `127.0.0.1:<random>`.
//!   2. When the engine spawns a `claude` child for a topic, it injects
//!      `--settings '{"hooks":{"PermissionRequest":[…]}}'` pointing at
//!      `http://127.0.0.1:<port>/permission/<topic_id>`. This rides
//!      ALONGSIDE whatever the user has in `~/.claude/settings.json` —
//!      `--settings` ADDS rather than replaces.
//!   3. Claude needs to use a non-allowlisted tool → POSTs the standard
//!      hook input JSON to that URL, blocking until the response.
//!   4. Our handler stores a oneshot, emits `salmon-permission-request`
//!      on the AppHandle. The frontend already listens for this and
//!      renders `<PermissionCard>` with Allow/Deny buttons.
//!   5. The user clicks → Tauri command `approve_permission` calls
//!      `bridge.answer(request_id, allow)`, which sends through the
//!      oneshot. The HTTP handler's `await` resolves and we reply with
//!      the documented `permissionDecision` JSON.
//!
//! Lifecycle
//! ---------
//! The bridge runs for the entire app lifetime; no per-topic teardown.
//! Pending requests whose Claude child gets killed (interrupt, topic
//! delete) just leak a oneshot until either (a) the user later clicks
//! the now-stale card, or (b) the app exits. Both are bounded.

use std::collections::HashMap;
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
        let pending: Arc<Mutex<Pending>> = Arc::new(Mutex::new(HashMap::new()));
        let bridge = Self {
            port,
            app: app.clone(),
            pending: pending.clone(),
        };

        let router = Router::new()
            .route("/permission/:topic_id", post(handle_permission))
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
    /// spawned child routes its PermissionRequest events at us. Per-topic
    /// URL lets us scope the eventual UI emission to the right Topic
    /// (which can otherwise have several spawns in flight).
    pub fn settings_json_for_topic(&self, topic_id: &str) -> String {
        json!({
            "hooks": {
                "PermissionRequest": [{
                    "matcher": "",
                    "hooks": [{
                        "type": "http",
                        "url": format!("http://127.0.0.1:{}/permission/{}", self.port, topic_id),
                        "timeout": 600,
                    }]
                }]
            }
        })
        .to_string()
    }
}

async fn handle_permission(
    State(bridge): State<PermissionBridge>,
    Path(topic_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
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

    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<bool>();
    bridge.pending.lock().insert(request_id.clone(), tx);

    eprintln!(
        "[salmon] PermissionRequest topic={topic_id} tool={tool_name} request_id={request_id}"
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

    // The PermissionRequest hook spec accepts `permissionDecision` of
    // "allow" | "deny" inside `hookSpecificOutput`. Echo back the request
    // id for our own debugging via stderr.
    eprintln!(
        "[salmon] permission resolved request_id={request_id} decision={}",
        if allow { "allow" } else { "deny" }
    );
    (
        StatusCode::OK,
        Json(json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "permissionDecision": if allow { "allow" } else { "deny" },
                "permissionDecisionReason": "Salmon UI",
            }
        })),
    )
}
