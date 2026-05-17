//! Home-feed briefing pipeline.
//!
//! Produces a single time-ranked, type-mixed list of "things you might want
//! to touch right now" by merging:
//!   - Unread mail flagged as important (VIP sender / replies-needed cues)
//!   - Calendar events within the next 24 h
//!   - Topics that need attention (errors / unread assistant turns)
//!   - Existing AI Recommendations from the claude/codex pipeline
//!
//! Ranking is pure heuristic — no LLM call inside this module. The LLM-
//! powered side already runs out-of-band via commands::generate_recommendations
//! (claude/codex subprocesses); those rows feed into us as one input. This
//! keeps the home feed *instant* on every refresh: no waiting on an LLM,
//! while still surfacing AI suggestions when they exist.

use salmon_core::db::Db;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
// IMPORTANT: For an internally-tagged enum with struct variants, plain
// `rename_all = "camelCase"` would lower-case the variant *names* (Mail
// → "mail") and leave the inner fields snake_case. The FE expects PascalCase
// variant names ("Mail", "Event", ...) + camelCase field names. Use
// `rename_all_fields` (serde >= 1.0.156) to rename inner fields without
// touching the variant names.
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum FeedItem {
    /// An unread (or recently-arrived) mail message worth surfacing.
    Mail {
        id: String,
        account_id: String,
        from_name: Option<String>,
        from_email: Option<String>,
        subject: Option<String>,
        snippet: Option<String>,
        date_ms: i64,
        is_vip: bool,
        score: f64,
    },
    /// Calendar event in the next 24 h.
    Event {
        id: String,
        account_id: String,
        start_ms: i64,
        end_ms: i64,
        all_day: bool,
        title: Option<String>,
        location: Option<String>,
        score: f64,
    },
    /// Topic that the engine flagged as needing attention.
    Topic {
        id: String,
        title: String,
        engine: String,
        workdir: String,
        updated_at: i64,
        reason: String,
        score: f64,
    },
    /// Existing AI recommendation. We don't regenerate — just surface.
    Recommendation {
        id: String,
        title: String,
        rationale: String,
        action_hint: String,
        priority: String,
        source_engine: String,
        score: f64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingFeed {
    pub generated_at: i64,
    pub items: Vec<FeedItem>,
}

/// Build the home feed. Pure read — no LLM call. Caller should invoke
/// `generate_recommendations` separately on its own cadence if it wants
/// fresh AI rows.
pub fn build_feed(db: &Db) -> Result<BriefingFeed> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut items: Vec<FeedItem> = Vec::new();

    items.extend(important_mail(db, now_ms)?);
    items.extend(upcoming_events(db, now_ms)?);
    items.extend(stuck_topics(db, now_ms)?);
    items.extend(recent_recommendations(db)?);

    // Sort by score descending. The freshness component inside each scorer
    // already encodes recency, so equal scores really do mean "equally
    // relevant" — no separate tie-break needed.
    items.sort_by(|a, b| {
        let sa = score_of(a);
        let sb = score_of(b);
        sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
    });
    items.truncate(20);

    Ok(BriefingFeed {
        generated_at: now_ms,
        items,
    })
}

fn score_of(it: &FeedItem) -> f64 {
    match it {
        FeedItem::Mail { score, .. } => *score,
        FeedItem::Event { score, .. } => *score,
        FeedItem::Topic { score, .. } => *score,
        FeedItem::Recommendation { score, .. } => *score,
    }
}

fn important_mail(db: &Db, now_ms: i64) -> Result<Vec<FeedItem>> {
    // Unread mail in last 72 h. Score = freshness + VIP bonus.
    let cutoff = now_ms - 72 * 3600_000;
    let mut stmt = db.conn().prepare(
        "SELECT m.id, m.account_id, m.from_email, m.from_name, m.subject,
                m.snippet, m.date_ms,
                COALESCE((SELECT c.is_vip FROM contacts c
                          WHERE c.account_id = m.account_id
                            AND lower(c.email) = lower(m.from_email)), 0) AS vip
         FROM mail_messages m
         WHERE m.unread = 1 AND m.date_ms >= ?
         ORDER BY m.date_ms DESC
         LIMIT 50",
    )?;
    let rows = stmt.query_map(params![cutoff], |r| {
        let date_ms: i64 = r.get(6)?;
        let vip: i64 = r.get(7)?;
        let age_hours = ((now_ms - date_ms).max(0) as f64) / 3600_000.0;
        // Freshness: e^(-age/24) — 1.0 at zero, ~0.05 at 72h.
        let freshness = (-age_hours / 24.0).exp();
        let score = freshness + if vip > 0 { 0.5 } else { 0.0 };
        Ok(FeedItem::Mail {
            id: r.get(0)?,
            account_id: r.get(1)?,
            from_email: r.get(2)?,
            from_name: r.get(3)?,
            subject: r.get(4)?,
            snippet: r.get(5)?,
            date_ms,
            is_vip: vip > 0,
            score,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn upcoming_events(db: &Db, now_ms: i64) -> Result<Vec<FeedItem>> {
    // Events that start in the next 24 h (or are currently happening).
    let lookahead = now_ms + 86400_000;
    let mut stmt = db.conn().prepare(
        "SELECT id, account_id, start_ms, end_ms, all_day, title, location
         FROM calendar_events
         WHERE end_ms >= ? AND start_ms <= ?
         ORDER BY start_ms ASC
         LIMIT 20",
    )?;
    let rows = stmt.query_map(params![now_ms - 3600_000, lookahead], |r| {
        let start_ms: i64 = r.get(2)?;
        let minutes_until = ((start_ms - now_ms).max(0) as f64) / 60_000.0;
        // Events closer in time score higher; in-progress events score highest.
        let score = if start_ms <= now_ms {
            1.4 // in progress
        } else {
            1.2 + (-minutes_until / 240.0).exp() * 0.4
        };
        Ok(FeedItem::Event {
            id: r.get(0)?,
            account_id: r.get(1)?,
            start_ms,
            end_ms: r.get(3)?,
            all_day: r.get::<_, i64>(4)? != 0,
            title: r.get(5)?,
            location: r.get(6)?,
            score,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn stuck_topics(db: &Db, now_ms: i64) -> Result<Vec<FeedItem>> {
    // Topics touched in the last 14 days that aren't archived. The "needs
    // attention" signal is folded in by the FE (it knows about pending
    // permissions, errors, runtime state); here we just surface recent
    // active Topics so they show up in the mixed feed.
    let cutoff = now_ms - 14 * 86400_000;
    let mut stmt = db.conn().prepare(
        "SELECT id, title, engine, workdir, updated_at
         FROM topics
         WHERE archived = 0 AND updated_at >= ?
         ORDER BY updated_at DESC
         LIMIT 10",
    )?;
    let rows = stmt.query_map(params![cutoff], |r| {
        let updated_at: i64 = r.get(4)?;
        let age_hours = ((now_ms - updated_at).max(0) as f64) / 3600_000.0;
        // Lower score than mail/events to keep them out of the way
        // unless really recent.
        let score = 0.6 * (-age_hours / 48.0).exp();
        Ok(FeedItem::Topic {
            id: r.get(0)?,
            title: r.get(1)?,
            engine: r.get(2)?,
            workdir: r.get(3)?,
            updated_at,
            reason: "最近活动".into(),
            score,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn recent_recommendations(db: &Db) -> Result<Vec<FeedItem>> {
    // Pending recommendations from the LLM pipeline, last 7 days.
    let cutoff = chrono::Utc::now().timestamp_millis() - 7 * 86400_000;
    let mut stmt = db.conn().prepare(
        "SELECT id, title, rationale, action_hint, priority, source_engine
         FROM recommendations
         WHERE status = 'pending' AND generated_at >= ?
         ORDER BY generated_at DESC
         LIMIT 6",
    )?;
    let rows = stmt.query_map(params![cutoff], |r| {
        let priority: String = r.get(4)?;
        // High-priority recs trump everything else.
        let score = match priority.as_str() {
            "high" => 1.8,
            "medium" => 1.0,
            _ => 0.5,
        };
        Ok(FeedItem::Recommendation {
            id: r.get(0)?,
            title: r.get(1)?,
            rationale: r.get(2)?,
            action_hint: r.get(3)?,
            priority,
            source_engine: r.get(5)?,
            score,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}
