//! Writer — on-demand reply-draft generation. Called when the user clicks
//! a suggestedAction whose steps include `kind=reply`.
//!
//! Sync caller does DB IO (`gather_reply_context`) under a brief lock, then
//! awaits `draft_reply` with the owned snapshot. This avoids holding the
//! DB MutexGuard across await (rusqlite's connection is !Sync).

use salmon_core::db::Db;
use crate::llm::{call_llm, truncate_chars};
use anyhow::{Context, Result};
use rusqlite::params;

const TONE_SAMPLE_COUNT: usize = 3;
const TONE_SAMPLE_CHARS: usize = 600;
const PARENT_BODY_CHARS: usize = 2000;

pub struct ReplyContext {
    pub subject: String,
    pub from_email: String,
    pub body: String,
    pub tone_samples: Vec<String>,
}

/// Sync DB read. Drop the lock after this returns, then call `draft_reply`.
pub fn gather_reply_context(db: &Db, parent_mail_id: &str) -> Result<ReplyContext> {
    let (subject, from_email, body) = load_parent(db, parent_mail_id)?;
    let tone_samples = load_tone_samples(db, &from_email)?;
    Ok(ReplyContext {
        subject,
        from_email,
        body,
        tone_samples,
    })
}

pub async fn draft_reply(
    engine: &str,
    ctx: &ReplyContext,
    intent_detail: &str,
) -> Result<String> {
    let prompt = build_prompt(
        &ctx.subject,
        &ctx.from_email,
        &ctx.body,
        &ctx.tone_samples,
        intent_detail,
    );
    let raw = call_llm(engine, SYSTEM, &prompt).await?;
    let cleaned = strip_fences(&raw);
    Ok(cleaned.trim().to_string())
}

const SYSTEM: &str = r#"你是 SalmonApp 的回信起草助手。你的输出会被用户审阅后**手动**发送，永不自动发送。

【硬规则】
- 输出**只有回信正文本身**，纯文本，不要 markdown 代码块。
- 不要写 "Subject:" / "Dear ..."（除非语气样本明显这么写）；自然语言开头即可。
- 用户的语气是从他过去给同一收件人发的邮件里学的 — 保持一致，不夸张不僵化。
- 内容要紧贴用户指明的 intent（"回信用意"），不要自由发挥。
- 长度跟随原邮件长度，简短问询 → 简短回。
- 用中文（除非原邮件是英文）。
"#;

fn build_prompt(
    subject: &str,
    from_email: &str,
    body: &str,
    tone_samples: &[String],
    intent: &str,
) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "【原邮件】发件人: {}\n主题: {}\n<email>\n{}\n</email>\n\n",
        from_email,
        subject,
        truncate_chars(body, PARENT_BODY_CHARS),
    ));
    if !tone_samples.is_empty() {
        s.push_str("【你过去给这个人发过的邮件（语气样本，不要照抄内容）】\n");
        for (i, sample) in tone_samples.iter().enumerate() {
            s.push_str(&format!("--- 样本 {} ---\n{}\n", i + 1, sample));
        }
        s.push('\n');
    }
    s.push_str(&format!("【你这次的回信用意】\n{}\n\n", intent));
    s.push_str("现在直接输出回信正文：");
    s
}

fn load_parent(db: &Db, mail_id: &str) -> Result<(String, String, String)> {
    let row = db.conn().query_row(
        "SELECT subject, from_email, body_text, snippet
         FROM mail_messages WHERE id = ?",
        params![mail_id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        },
    )?;
    let subject = row.0.unwrap_or_default();
    let from_email = row.1.unwrap_or_default();
    let body = row.2.or(row.3).unwrap_or_default();
    Ok((subject, from_email, body))
}

fn load_tone_samples(db: &Db, counterparty: &str) -> Result<Vec<String>> {
    let lc = counterparty.to_lowercase();
    let mut stmt = db.conn().prepare(
        "SELECT body_text, snippet, to_emails, from_email
         FROM mail_messages
         WHERE to_emails LIKE ?
         ORDER BY date_ms DESC
         LIMIT 30",
    )?;
    let like = format!("%{}%", lc);
    let rows = stmt.query_map(params![like], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;
    let own = load_own_addresses(db)?;
    let mut out = Vec::new();
    for row in rows {
        let (body, snip, to_json, from_email) = row?;
        let from_lower = from_email.as_deref().map(|s| s.to_lowercase()).unwrap_or_default();
        if !own.contains(&from_lower) {
            continue;
        }
        let to_has_them = to_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(s).ok())
            .map(|arr| {
                arr.iter().any(|v| {
                    v.get("email")
                        .and_then(|x| x.as_str())
                        .map(|e| e.to_lowercase() == lc)
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
        if !to_has_them {
            continue;
        }
        let text = body.or(snip).unwrap_or_default();
        if !text.trim().is_empty() {
            out.push(truncate_chars(&text, TONE_SAMPLE_CHARS));
        }
        if out.len() >= TONE_SAMPLE_COUNT {
            break;
        }
    }
    Ok(out)
}

fn load_own_addresses(db: &Db) -> Result<std::collections::HashSet<String>> {
    let mut out = std::collections::HashSet::new();
    let mut stmt = db.conn().prepare("SELECT email FROM mail_accounts")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .context("query own addrs")?;
    for r in rows {
        out.insert(r?.to_lowercase());
    }
    Ok(out)
}

fn strip_fences(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("```") {
        let rest = rest.trim_start_matches(|c: char| c != '\n').trim_start_matches('\n');
        if let Some(idx) = rest.rfind("```") {
            return rest[..idx].to_string();
        }
        return rest.to_string();
    }
    t.to_string()
}
