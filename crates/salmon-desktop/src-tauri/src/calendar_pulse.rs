//! Calendar Pulse — heuristic analyzer over local `calendar_events`.
//!
//! Surfaces upcoming events that need attention NOW: starting within the
//! next 8 hours OR running in the next hour. No LLM call — deterministic
//! and cheap. Also flags simple conflicts (two events overlap in time).
//!
//! Output PulseItems are written by the orchestrator with kind="event"
//! in brief_items.

use crate::calendar::{list_events_window, CalEvent};
use salmon_core::db::Db;
use crate::pulse::{ActionStep, PulseItem, SuggestedAction};
use anyhow::Result;

/// How far ahead to scan for "starting soon" classification.
const SOON_WINDOW_MS: i64 = 8 * 3600_000;

/// Slop for "currently running" detection — events whose start is at
/// most this far in the past but end is still in the future.
const RUNNING_SLOP_MS: i64 = 60_000;

pub fn analyse(db: &Db) -> Result<Vec<PulseItem>> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    // Scan from one hour ago through eight hours ahead so we catch both
    // mid-running events and the next chunk of the day.
    let events = list_events_window(
        db,
        now_ms - 3600_000,
        now_ms + SOON_WINDOW_MS,
    )?;

    let mut out: Vec<PulseItem> = Vec::new();

    // Conflict detection: events whose times overlap.
    let mut sorted = events.clone();
    sorted.sort_by_key(|e| e.start_ms);
    for i in 0..sorted.len() {
        for j in (i + 1)..sorted.len() {
            let a = &sorted[i];
            let b = &sorted[j];
            if b.start_ms >= a.end_ms {
                break; // sorted by start, so further js cannot overlap a
            }
            // Same-account self-overlap counts (user is double-booked).
            // Cross-account is also a conflict — both calendars belong
            // to the user.
            if let Some(item) = render_conflict_item(a, b, now_ms) {
                out.push(item);
            }
        }
    }

    // Starting-soon + currently-running individual events. Skip all-day
    // entries from this bucket — they don't have a meaningful "starting
    // in X hours" framing.
    for e in &events {
        if e.all_day {
            continue;
        }
        let cls = classify(e, now_ms);
        let Some(c) = cls else { continue };
        out.push(render_event_item(e, c));
    }

    Ok(out)
}

enum Classification {
    Running { minutes_into: i64 },
    StartingSoon { minutes_until: i64 },
}

fn classify(e: &CalEvent, now_ms: i64) -> Option<Classification> {
    if e.start_ms <= now_ms + RUNNING_SLOP_MS && e.end_ms > now_ms {
        let minutes_into = ((now_ms - e.start_ms) / 60_000).max(0);
        return Some(Classification::Running { minutes_into });
    }
    if e.start_ms > now_ms && e.start_ms - now_ms <= SOON_WINDOW_MS {
        let minutes_until = (e.start_ms - now_ms) / 60_000;
        return Some(Classification::StartingSoon { minutes_until });
    }
    None
}

fn render_event_item(e: &CalEvent, cls: Classification) -> PulseItem {
    let title_core = e
        .title
        .clone()
        .unwrap_or_else(|| "(无标题事件)".into());
    let title = format!("日程: {}", truncate_chars(&title_core, 22));
    let when = format_local(e.start_ms);
    let location = e.location.clone().unwrap_or_default();
    let location_tail = if location.is_empty() {
        String::new()
    } else {
        format!(" @ {}", location)
    };
    let summary = format!("{}{}", when, location_tail);

    let (priority, why) = match cls {
        Classification::Running { minutes_into } => (
            "high".to_string(),
            format!("已经开始 {} 分钟。", minutes_into),
        ),
        Classification::StartingSoon { minutes_until } => {
            let p = if minutes_until <= 30 { "high" } else { "medium" };
            (
                p.to_string(),
                format!("将在 {} 分钟后开始。", minutes_until),
            )
        }
    };

    let suggested = vec![
        SuggestedAction {
            label: "我已确认会参加".into(),
            steps: vec![ActionStep {
                kind: "acknowledge".into(),
                detail: format!("event_id:{}", e.id),
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
        related_event_ids: vec![e.id.clone()],
        deadline_ms: Some(e.start_ms),
        suggested_actions: suggested,
    }
}

fn render_conflict_item(a: &CalEvent, b: &CalEvent, _now_ms: i64) -> Option<PulseItem> {
    // Only flag conflicts within the next 24 hours — past conflicts are
    // already user-resolved.
    let now_ms = chrono::Utc::now().timestamp_millis();
    if a.end_ms < now_ms || a.start_ms > now_ms + 24 * 3600_000 {
        return None;
    }
    let a_title = a.title.clone().unwrap_or_else(|| "(无标题)".into());
    let b_title = b.title.clone().unwrap_or_else(|| "(无标题)".into());
    let title = format!(
        "日程冲突: {} ↔ {}",
        truncate_chars(&a_title, 14),
        truncate_chars(&b_title, 14)
    );
    let when_a = format_local(a.start_ms);
    let when_b = format_local(b.start_ms);
    let summary = format!("{} 与 {} 时间重叠", when_a, when_b);
    let why = "两个日历事件时间互相覆盖，需要选一个参加或调整。".to_string();

    let suggested = vec![
        SuggestedAction {
            label: "我已确认安排".into(),
            steps: vec![ActionStep {
                kind: "acknowledge".into(),
                detail: format!("conflict:{}|{}", a.id, b.id),
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

    Some(PulseItem {
        title,
        summary,
        priority: "high".into(),
        why,
        related_mail_ids: Vec::new(),
        related_event_ids: vec![a.id.clone(), b.id.clone()],
        deadline_ms: Some(a.start_ms.min(b.start_ms)),
        suggested_actions: suggested,
    })
}

fn format_local(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|t| {
            t.with_timezone(&chrono::Local)
                .format("%m-%d %H:%M")
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
