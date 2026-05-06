use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    pub id: String,
    pub title: String,
    pub engine: String,
    pub workdir: String,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub danger_mode: bool,
    #[serde(default)]
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub topic_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<serde_json::Value>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub name: String,
    pub binary: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub logged_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
    pub state: String, // running | done | cancelled | error
    pub result: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub id: String,
    pub source_engine: String,
    pub topic_id: Option<String>,
    pub title: String,
    pub rationale: String,
    pub action_hint: String,
    /// Concrete payoff: what the user feels different the moment they accept.
    /// Forward-looking complement to `rationale` (which looks back at why this
    /// item exists). Empty string for legacy rows.
    #[serde(default)]
    pub payoff: String,
    pub status: String,
    /// `high` = both engines rated high → default-shown
    /// `medium` = at least one rated medium-or-better
    /// `low` = either engine rated low → folded
    #[serde(default)]
    pub priority: String,
    /// Originating engine's own self-rating: 'high'|'medium'|'low'
    #[serde(default)]
    pub self_value: Option<String>,
    /// The OTHER engine's rating of this candidate: 'high'|'medium'|'low'
    #[serde(default)]
    pub peer_value: Option<String>,
    pub generated_at: i64,
    pub decided_at: Option<i64>,
    pub decision_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum StreamEvent {
    Started { topic_id: String, session_id: Option<String> },
    AssistantText { topic_id: String, message_id: String, delta: String },
    AssistantDone { topic_id: String, message_id: String, content: String },
    /// Extended-thinking reasoning text from Claude. Surfaced separately
    /// from AssistantDone so the UI can fold it into the 思考过程 section
    /// instead of the visible answer.
    Thinking { topic_id: String, message_id: String, content: String },
    ToolCall { topic_id: String, tool: ToolCall },
    ToolResult { topic_id: String, tool_id: String, state: String, result: Option<String> },
    PermissionRequest { topic_id: String, request_id: String, tool: String, input: serde_json::Value, command: Option<String> },
    Error { topic_id: String, message: String },
    Exited { topic_id: String, code: Option<i32> },
    /// The whole `run_session` driver task ended (panic, channel closed, etc.).
    /// Distinct from `Exited`, which fires after every per-prompt child wait.
    /// The frontend uses this to evict the topic from `runningIds` so a future
    /// `onSelect` re-spawns instead of trusting a stale Sender.
    SessionEnded { topic_id: String },
    Log { topic_id: String, line: String },
}
