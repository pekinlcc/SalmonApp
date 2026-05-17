//! Task Pulse — heuristic analyzer over the local `tasks` table.
//!
//! Surfaces open tasks that are overdue or due within the next 24h, plus
//! "stale-near-deadline" buckets. No LLM call — fully deterministic so
//! it adds zero token cost to the briefing run and runs in milliseconds.
//!
//! Output PulseItems are written by the orchestrator with kind="task" in
//! brief_items.

use crate::db::Db;
use crate::pulse::{ActionStep, PulseItem, SuggestedAction};
use crate::tasks::{list_tasks_local, Task};
use anyhow::Result;

/// Look-forward window for "due soon" classification. Tasks with
/// due_ms within (now, now + this) are surfaced as medium priority.
const DUE_SOON_MS: i64 = 24 * 3600_000;

/// Soft floor for "stuck open too long". Tasks created more than this
/// ago, still pending, without a due date — surfaced as low priority.
const STALE_AGE_MS: i64 = 14 * 24 * 3600_000;

pub fn analyse(db: &Db) -> Result<Vec<PulseItem>> {
    let tasks = list_tasks_local(db, None, false)?; // include_completed=false
    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut out = Vec::new();

    for t in tasks {
        if t.completed {
            continue;
        }
        let item = match classify(&t, now_ms) {
            Some(cls) => render_task_item(t, cls),
            None => continue,
        };
        out.push(item);
    }

    // Stable order: overdue first, then due-soon, then stale. Within each
    // bucket, earlier due_ms (or created_at for stale) comes first. The
    // briefing-LLM step does its own re-ranking so order is mostly
    // cosmetic for the heuristic-fallback path.
    out.sort_by(|a, b| {
        let pa = priority_rank(&a.priority);
        let pb = priority_rank(&b.priority);
        pa.cmp(&pb)
            .then_with(|| a.deadline_ms.unwrap_or(i64::MAX).cmp(&b.deadline_ms.unwrap_or(i64::MAX)))
    });
    Ok(out)
}

enum Classification {
    Overdue { days_late: i64 },
    DueSoon,
    Stale,
}

fn classify(t: &Task, now_ms: i64) -> Option<Classification> {
    if let Some(due) = t.due_ms {
        if due < now_ms - 60_000 {
            let days_late = (now_ms - due) / (24 * 3600_000);
            return Some(Classification::Overdue { days_late });
        }
        if due <= now_ms + DUE_SOON_MS {
            return Some(Classification::DueSoon);
        }
        return None;
    }
    // No due date — only surface if it's been hanging around forever.
    if t.created_at < now_ms - STALE_AGE_MS {
        return Some(Classification::Stale);
    }
    None
}

fn render_task_item(t: Task, cls: Classification) -> PulseItem {
    let (priority, why_prefix, primary_label) = match &cls {
        Classification::Overdue { days_late } => (
            "high".to_string(),
            format!("已逾期 {} 天，再拖会失约。", days_late),
            // v1.19.2: was "处理逾期" — read as if SalmonApp would mutate
            // the task. The executor only marks the brief item as acked
            // (no real toggle in Google Tasks / Outlook ToDo until the
            // task_toggle Wave-5 plumbing lands). Reword to user-side
            // intent so the button matches what actually happens.
            "我会处理",
        ),
        Classification::DueSoon => (
            "medium".to_string(),
            "24 小时内到期。".to_string(),
            "今天会做",
        ),
        Classification::Stale => (
            "low".to_string(),
            "14 天前创建仍未完成，可能已不相关。".to_string(),
            "我会审视一下",
        ),
    };

    let title_core = truncate_chars(&t.title, 24);
    let title = format!("待办: {}", title_core);
    let due_str = t.due_ms.map(format_local).unwrap_or_else(|| "无截止日期".into());
    let summary = format!("{}（截止 {}）", title_core, due_str);
    let why = format!("{}详情: {}", why_prefix, t.notes.as_deref().unwrap_or(""));

    // Both suggestions are acknowledge-only today; primary is the
    // bucket-specific framing ("我会处理 / 今天会做 / 我会审视"), secondary
    // is the generic "我已知晓". The task id is still attached to the
    // primary step's detail so future Wave-5 task_toggle plumbing can
    // pick it up without changing the on-disk briefing payload format.
    let suggested = vec![
        SuggestedAction {
            label: format!("✓ {}", primary_label),
            steps: vec![ActionStep {
                kind: "acknowledge".into(),
                detail: format!("task_id:{}", t.id),
            }],
        },
        SuggestedAction {
            label: "我已知晓".into(),
            steps: vec![ActionStep {
                kind: "acknowledge".into(),
                detail: String::new(),
            }],
        },
    ];

    PulseItem {
        title,
        summary,
        priority,
        why,
        related_mail_ids: Vec::new(),
        related_event_ids: Vec::new(),
        deadline_ms: t.due_ms,
        suggested_actions: suggested,
    }
}

fn priority_rank(p: &str) -> i32 {
    match p {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    }
}

fn format_local(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|t| {
            t.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| "(无效时间)".into())
}

fn truncate_chars(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max {
        return s.to_string();
    }
    s.chars().take(max).collect::<String>() + "…"
}
