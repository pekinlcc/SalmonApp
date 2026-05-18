//! Event Extractor — given an intent string like "加日历: K 年级说明会 5/12
//! 17:40 校礼堂" + optional source-mail text, ask the LLM for a structured
//! CalEvent (title / start_ms / end_ms / location).
//!
//! Caller does the DB read up-front under a brief lock and passes the
//! optional `context_text` here — the LLM call itself holds no DB lock.

use crate::date_context::{format_local_datetime, relative_date_hint};
use crate::db::Db;
use crate::llm::{call_llm, extract_json_object, truncate_chars};
use anyhow::{anyhow, Context, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedEvent {
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    pub location: Option<String>,
}

/// Synchronous DB read: gather the context the LLM needs. Caller holds the
/// DB lock just for this, then drops it before calling `extract()`.
pub fn load_mail_context(db: &Db, mail_id: &str) -> Result<String> {
    let row = db.conn().query_row(
        "SELECT subject, body_text, snippet, date_ms FROM mail_messages WHERE id = ?",
        params![mail_id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
            ))
        },
    )?;
    let mut s = String::new();
    s.push_str(&format!("邮件日期: {}\n", format_local_datetime(row.3)));
    let subj_for_hint = row.0.clone().unwrap_or_default();
    let body_for_hint = row.1.clone().or(row.2.clone()).unwrap_or_default();
    if let Some(hint) = relative_date_hint(row.3, &format!("{} {}", subj_for_hint, body_for_hint)) {
        s.push_str(&format!("相对日期提示: {}\n", hint));
    }
    if let Some(subj) = row.0 {
        s.push_str(&format!("主题: {}\n", subj));
    }
    if let Some(body) = row.1.or(row.2) {
        s.push_str(&body);
    }
    Ok(s)
}

pub async fn extract(
    engine: &str,
    intent_detail: &str,
    context_text: &str,
) -> Result<ExtractedEvent> {
    let prompt = build_prompt(intent_detail, context_text);
    let raw = call_llm(engine, SYSTEM, &prompt).await?;
    parse(&raw)
}

const SYSTEM: &str = r#"你是 SalmonApp 的日历事件提取助手。任务是从一段自然语言（含可选的原邮件正文）里提取结构化的日历事件。

【硬规则】
- 时间解析必须精确：相对时间（"明天 3 点"）→ 用当前时间为基准；缺年份默认今年；缺时区默认本地时区。
- 如果相对时间出现在【原邮件上下文】里，必须以邮件日期为基准，不得以当前时间为基准；例如邮件日期是 2026-05-14，正文说"明天/明早"就是 2026-05-15。解析出的时间早于当前时间时，视为已过期，不要创建新的未来日历事件。
- 找不到明确开始时间 → 用"今天的下一个整点"作为兜底。
- 找不到明确结束时间 → start + 1 小时。
- 全天事件（只有日期没有时间）→ allDay=true，start = 当天 00:00 本地。
- 输出 epoch ms（UTC）。

【输出格式 - 严格 JSON】
{
  "title": "≤40 字",
  "startMs": 1717200000000,
  "endMs": 1717203600000,
  "allDay": false,
  "location": "可选，≤80 字 / null"
}
"#;

fn build_prompt(intent: &str, context: &str) -> String {
    let now_local = chrono::Local::now().format("%Y-%m-%d %H:%M %Z").to_string();
    let mut s = format!("【当前时间】{}\n\n【用户意图】{}\n", now_local, intent);
    if !context.is_empty() {
        s.push_str(&format!(
            "\n【原邮件上下文】<email>\n{}\n</email>\n",
            truncate_chars(context, 1500)
        ));
    }
    s
}

fn parse(raw: &str) -> Result<ExtractedEvent> {
    let body = extract_json_object(raw).ok_or_else(|| anyhow!("Extractor: 无 JSON"))?;
    let v: serde_json::Value = serde_json::from_str(&body).context("Extractor parse")?;
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let start_ms = v
        .get("startMs")
        .and_then(|x| x.as_i64())
        .ok_or_else(|| anyhow!("缺 startMs"))?;
    let end_ms = v
        .get("endMs")
        .and_then(|x| x.as_i64())
        .unwrap_or(start_ms + 3600_000);
    let all_day = v.get("allDay").and_then(|x| x.as_bool()).unwrap_or(false);
    let location = v.get("location").and_then(|x| x.as_str()).map(String::from);
    if title.is_empty() {
        return Err(anyhow!("Extractor: 缺 title"));
    }
    Ok(ExtractedEvent {
        title,
        start_ms,
        end_ms,
        all_day,
        location,
    })
}
