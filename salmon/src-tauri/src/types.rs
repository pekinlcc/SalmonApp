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
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum StreamEvent {
    Started { topic_id: String, session_id: Option<String> },
    AssistantText { topic_id: String, message_id: String, delta: String },
    AssistantDone { topic_id: String, message_id: String, content: String },
    ToolCall { topic_id: String, tool: ToolCall },
    ToolResult { topic_id: String, tool_id: String, state: String, result: Option<String> },
    PermissionRequest { topic_id: String, request_id: String, tool: String, input: serde_json::Value, command: Option<String> },
    Error { topic_id: String, message: String },
    Exited { topic_id: String, code: Option<i32> },
    Log { topic_id: String, line: String },
}
