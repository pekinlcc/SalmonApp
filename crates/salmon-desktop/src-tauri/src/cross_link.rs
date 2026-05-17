//! Cross-link — one lightweight LLM call that compares the mail
//! engine's output (PulseItems → BriefItems after Briefing) and the
//! topic engine's output (existing Recommendations), and tells us which
//! pairs are actually about the same thing.
//!
//! Output is merge instructions; the orchestrator applies them by
//! producing a combined `kind: 'cross'` BriefItem and dropping the
//! originals.
//!
//! Cheap by design: input is only titles + ≤80-char whys + topic
//! workdirs / titles. No bodies. Should run in <20s.

use crate::llm::{call_llm, extract_json_object};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

/// One mail-side candidate as seen by the cross-link prompt.
#[derive(Debug, Clone, Serialize)]
pub struct MailSummary {
    pub id: String,
    pub title: String,
    pub why: String,
    pub contact_email: String,
    pub priority: String,
}

/// One topic-side candidate.
#[derive(Debug, Clone, Serialize)]
pub struct TopicSummary {
    pub id: String,
    pub topic_id: String,
    pub topic_title: String,
    pub workdir: String,
    pub title: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossLink {
    pub mail_ids: Vec<String>,
    pub topic_rec_ids: Vec<String>,
    pub combined_title: String,
    pub combined_why: String,
    pub combined_priority: String,
}

pub async fn cross_link(
    engine: &str,
    mail: &[MailSummary],
    topic: &[TopicSummary],
) -> Result<Vec<CrossLink>> {
    if mail.is_empty() || topic.is_empty() {
        return Ok(Vec::new());
    }
    let prompt = build_prompt(mail, topic);
    let system = SYSTEM.to_string();
    let raw = call_llm(engine, &system, &prompt).await?;
    parse(&raw)
}

const SYSTEM: &str = r#"你是 SalmonApp 的跨域关联助手。任务是找出"邮件待办"和"AI 对话推荐"里说的是同一件事的配对。

【硬规则】
- 只在非常确信是同一件事时合并（人名 + 项目名 / workdir 匹配 / 时间窗口 + 关键字命中）。
- 没有强关联的 item 不出现在输出里 — 留它们各自独立显示。
- combined_title ≤ 28 字；combined_why ≤ 80 字，说明"为什么是同一件事 + 为什么一起处理高效"。
- combined_priority 取两侧的最高优先级。
- 不要把同一个 mail id 用在多个 link 里（多个 topic id 可以指向同一 link，反之同理）。

【输出格式 - 严格 JSON】
{
  "links": [
    {
      "mailIds": ["mail-uuid-1"],
      "topicRecIds": ["rec-uuid-1"],
      "combinedTitle": "...",
      "combinedWhy": "...",
      "combinedPriority": "high|medium|low"
    }
  ]
}

实在找不到强关联就返回 {"links": []}.
"#;

fn build_prompt(mail: &[MailSummary], topic: &[TopicSummary]) -> String {
    let mut s = String::new();
    s.push_str("【邮件侧待办】\n");
    for m in mail {
        s.push_str(&format!(
            "- id={} · 联系人={} · 优先级={} · 标题={}\n  why: {}\n",
            m.id, m.contact_email, m.priority, m.title, m.why,
        ));
    }
    s.push_str("\n【Topic 侧推荐】\n");
    for t in topic {
        s.push_str(&format!(
            "- id={} · Topic=\"{}\" · workdir={}\n  动作: {}\n  理由: {}\n",
            t.id, t.topic_title, t.workdir, t.title, t.rationale,
        ));
    }
    s
}

fn parse(raw: &str) -> Result<Vec<CrossLink>> {
    let body = extract_json_object(raw)
        .ok_or_else(|| anyhow!("Cross-link: 无 JSON"))?;
    let v: serde_json::Value = serde_json::from_str(&body).context("Cross-link parse")?;
    let arr = v.get("links").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let mut out = Vec::new();
    for it in arr {
        let mail_ids: Vec<String> = it
            .get("mailIds")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let topic_ids: Vec<String> = it
            .get("topicRecIds")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        if mail_ids.is_empty() || topic_ids.is_empty() {
            continue;
        }
        let title = it.get("combinedTitle").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let why = it.get("combinedWhy").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let prio = it.get("combinedPriority").and_then(|x| x.as_str()).unwrap_or("medium");
        let prio = match prio {
            "high" | "medium" | "low" => prio.to_string(),
            _ => "medium".to_string(),
        };
        if title.is_empty() {
            continue;
        }
        out.push(CrossLink {
            mail_ids,
            topic_rec_ids: topic_ids,
            combined_title: title,
            combined_why: why,
            combined_priority: prio,
        });
    }
    Ok(out)
}
