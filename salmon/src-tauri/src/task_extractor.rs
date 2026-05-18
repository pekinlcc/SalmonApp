//! Task Extractor — given an intent string (e.g. "提交报名表 5/11 前") +
//! optional source-mail context, returns a structured {title, due_ms?}.
//! Sibling of event_extractor; same pattern.

use crate::llm::{call_llm, extract_json_object, truncate_chars};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedTask {
    pub title: String,
    pub due_ms: Option<i64>,
    pub notes: Option<String>,
}

pub async fn extract(
    engine: &str,
    intent_detail: &str,
    context_text: &str,
) -> Result<ExtractedTask> {
    let prompt = build_prompt(intent_detail, context_text);
    let raw = call_llm(engine, SYSTEM, &prompt).await?;
    parse(&raw)
}

const SYSTEM: &str = r#"你是 SalmonApp 的待办事项提取助手。从自然语言里提取结构化的 task。

【硬规则】
- title ≤30 字，简短动词起头（"提交…" / "回…" / "确认…"）。
- 找得到明确截止日期 → dueMs = epoch-ms（UTC）；没找到 → null。
- 相对日期（"周五前" / "明天" / "5/11 前"）：以当前时间为基准解析。
- 如果相对日期出现在【相关邮件上下文】里，必须以邮件日期为基准，不得以当前时间为基准；例如邮件日期是 2026-05-14，正文说"明天/明早"就是 2026-05-15。解析出的截止时间早于当前时间时，视为已过期；除非文本明确要求补办，否则 dueMs = null。
- "今天 / 今日" → 今天 23:59 本地。
- 缺年份默认今年。
- notes 是可选的补充说明（如来源邮件主题、相关人名），≤80 字 / null。

【输出格式 - 严格 JSON】
{
  "title": "...",
  "dueMs": null | 1717200000000,
  "notes": null | "..."
}
"#;

fn build_prompt(intent: &str, context: &str) -> String {
    let now_local = chrono::Local::now().format("%Y-%m-%d %H:%M %Z").to_string();
    let mut s = format!("【当前时间】{}\n\n【用户意图】{}\n", now_local, intent);
    if !context.is_empty() {
        s.push_str(&format!(
            "\n【相关邮件上下文】<email>\n{}\n</email>\n",
            truncate_chars(context, 1500)
        ));
    }
    s
}

fn parse(raw: &str) -> Result<ExtractedTask> {
    let body = extract_json_object(raw).ok_or_else(|| anyhow!("TaskExtractor: 无 JSON"))?;
    let v: serde_json::Value = serde_json::from_str(&body).context("TaskExtractor parse")?;
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let due_ms = v.get("dueMs").and_then(|x| x.as_i64());
    let notes = v.get("notes").and_then(|x| x.as_str()).map(String::from);
    if title.is_empty() {
        return Err(anyhow!("TaskExtractor: 缺 title"));
    }
    Ok(ExtractedTask {
        title,
        due_ms,
        notes,
    })
}
