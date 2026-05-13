//! Roost — aggregate local mail + calendar by **contact**, producing a
//! per-contact bundle that Pulse can analyse in one LLM call.
//!
//! Reads from SalmonApp's local tables (mail_messages, calendar_events,
//! contacts). Pure Rust, no LLM call. Fast.
//!
//! Two call sites:
//! - Daily Briefing pipeline (`briefing_orchestrator`) — lookback 14 days,
//!   no email filter, truncated to MAX_CONTACTS_PER_RUN for LLM budget.
//! - Contacts view on-demand (`mail_commands::get_contact_roost_bundle`) —
//!   lookback 30 days, filtered to one email, no truncation. Surfaces the
//!   exact same data structure the LLM saw (when run) so users can inspect
//!   what Pulse "knew" about a contact.
//!
//! Heuristics (apply to both call sites):
//! - Sender email lowercased; local-part kept as-is
//! - Skip auto-reply / no-reply addresses (regex on local-part)
//! - Include the user's outgoing mail to the same contact (Sent folder
//!   provides tone samples for Writer agent)
//! - Calendar events: include if the contact is in attendees OR organizer
//!   AND the event is within ±7d of now
//! - Bundle size cap: 12 most recent messages per contact (Pulse prompt
//!   budget). Older messages summarised as "and N earlier from this address".

use crate::db::Db;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const LOOKBACK_DAYS_BRIEFING: i64 = 14;
pub const LOOKBACK_DAYS_DETAIL: i64 = 30;
const CAL_WINDOW_DAYS: i64 = 7;
const MAX_MSGS_PER_CONTACT: usize = 12;
const MAX_CONTACTS_PER_RUN: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactBundle {
    pub email: String,
    pub display_name: Option<String>,
    pub is_vip: bool,
    pub interaction_count: i64,
    pub last_seen_ms: i64,
    pub messages: Vec<BundleMessage>,
    pub events: Vec<BundleEvent>,
    pub omitted_message_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleMessage {
    pub id: String,
    pub account_id: String,
    pub thread_id: Option<String>,
    pub from_me: bool,
    pub subject: Option<String>,
    pub snippet: Option<String>,
    pub body_text: Option<String>,
    pub date_ms: i64,
    pub unread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleEvent {
    pub id: String,
    pub title: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    pub location: Option<String>,
}

/// Aggregate. Walks mail_messages + calendar_events + contacts once each.
/// Returns one bundle per "interesting contact" we've talked to in the
/// lookback window.
///
/// - `lookback_days`: cutoff for mail. 14 for daily Briefing, 30 for the
///   Contacts view detail panel.
/// - `email_filter`: when Some, the result is limited to that email
///   (case-insensitive) and MAX_CONTACTS_PER_RUN truncation is bypassed.
///   Used by the on-demand path so the contact is always returned even if
///   they're far down the talk-frequency ranking.
pub fn build_bundles(
    db: &Db,
    lookback_days: i64,
    email_filter: Option<&str>,
) -> Result<Vec<ContactBundle>> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let cutoff = now_ms - lookback_days * 86400_000;
    let filter_lc = email_filter.map(|s| s.to_lowercase());

    // 1) Pull all mail in window, indexed by lowercased counterparty email.
    //    "Counterparty" = the not-me address: for inbound it's from_email,
    //    for sent it's the first to-recipient. The user's own addresses come
    //    from mail_accounts.
    let own_addrs = load_own_addresses(db)?;
    let mut by_contact: std::collections::HashMap<String, Vec<BundleMessage>> =
        std::collections::HashMap::new();

    {
        let mut stmt = db.conn().prepare(
            "SELECT id, account_id, thread_id, from_email, to_emails, subject,
                    snippet, body_text, date_ms, unread
             FROM mail_messages
             WHERE date_ms >= ?
             ORDER BY date_ms DESC",
        )?;
        let rows = stmt.query_map(params![cutoff], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
            ))
        })?;
        for row in rows {
            let (id, account_id, thread_id, from_email, to_json, subject,
                 snippet, body_text, date_ms, unread_int) = row?;
            let from_lower = from_email.as_deref().map(|s| s.to_lowercase());
            let from_me = from_lower
                .as_ref()
                .map(|e| own_addrs.contains(e))
                .unwrap_or(false);
            let counterparty = if from_me {
                // sent: first to recipient (not us)
                first_external_recipient(&to_json, &own_addrs)
            } else {
                from_lower.clone()
            };
            let Some(addr) = counterparty else { continue };
            if is_noreply(&addr) { continue }
            if let Some(want) = &filter_lc {
                if &addr != want { continue }
            }
            let msg = BundleMessage {
                id,
                account_id,
                thread_id,
                from_me,
                subject,
                snippet,
                body_text,
                date_ms,
                unread: unread_int != 0,
            };
            by_contact.entry(addr).or_default().push(msg);
        }
    }

    // 2) Pull contact-name / VIP info.
    let contact_meta = load_contact_meta(db)?;

    // 3) Pull calendar events in ±7d.
    let cal_start = now_ms - CAL_WINDOW_DAYS * 86400_000;
    let cal_end = now_ms + CAL_WINDOW_DAYS * 86400_000;
    let events_by_email = load_events_by_email(db, cal_start, cal_end)?;

    // 4) Build bundles + sort by "talk-frequency × VIP".
    let mut bundles: Vec<ContactBundle> = Vec::new();
    for (email, mut msgs) in by_contact {
        msgs.sort_by(|a, b| b.date_ms.cmp(&a.date_ms));
        let total = msgs.len();
        let omitted = total.saturating_sub(MAX_MSGS_PER_CONTACT);
        msgs.truncate(MAX_MSGS_PER_CONTACT);
        let meta = contact_meta.get(&email);
        let last_seen = msgs.first().map(|m| m.date_ms).unwrap_or(0);
        let events = events_by_email.get(&email).cloned().unwrap_or_default();
        bundles.push(ContactBundle {
            email: email.clone(),
            display_name: meta.and_then(|m| m.name.clone()),
            is_vip: meta.map(|m| m.is_vip).unwrap_or(false),
            interaction_count: meta.map(|m| m.interaction_count).unwrap_or(total as i64),
            last_seen_ms: last_seen,
            messages: msgs,
            events,
            omitted_message_count: omitted,
        });
    }

    bundles.sort_by(|a, b| {
        // VIP wins, then by interaction count, then by recency.
        let a_score = (if a.is_vip { 1 } else { 0 }, a.interaction_count, a.last_seen_ms);
        let b_score = (if b.is_vip { 1 } else { 0 }, b.interaction_count, b.last_seen_ms);
        b_score.cmp(&a_score)
    });
    // Single-contact path returns all matches as-is (typically 0 or 1).
    // Full-sweep path caps the daily Briefing's LLM cost.
    if filter_lc.is_none() {
        bundles.truncate(MAX_CONTACTS_PER_RUN);
    }

    Ok(bundles)
}

#[derive(Default)]
struct ContactMeta {
    name: Option<String>,
    is_vip: bool,
    interaction_count: i64,
}

fn load_contact_meta(db: &Db) -> Result<std::collections::HashMap<String, ContactMeta>> {
    let mut out = std::collections::HashMap::new();
    let mut stmt = db.conn().prepare(
        "SELECT email, name, is_vip, interaction_count FROM contacts",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?.to_lowercase(),
            r.get::<_, Option<String>>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
        ))
    })?;
    for row in rows {
        let (email, name, vip, ic) = row?;
        let meta = out.entry(email).or_insert_with(ContactMeta::default);
        if meta.name.is_none() { meta.name = name; }
        meta.is_vip = meta.is_vip || vip != 0;
        meta.interaction_count = meta.interaction_count.max(ic);
    }
    Ok(out)
}

fn load_own_addresses(db: &Db) -> Result<std::collections::HashSet<String>> {
    let mut out = std::collections::HashSet::new();
    let mut stmt = db.conn().prepare("SELECT email FROM mail_accounts")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    for row in rows {
        out.insert(row?.to_lowercase());
    }
    Ok(out)
}

fn first_external_recipient(
    to_json: &Option<String>,
    own_addrs: &std::collections::HashSet<String>,
) -> Option<String> {
    let raw = to_json.as_deref()?;
    let arr: Vec<serde_json::Value> = serde_json::from_str(raw).ok()?;
    for v in arr {
        let email = v.get("email").and_then(|x| x.as_str())?;
        let lower = email.to_lowercase();
        if !own_addrs.contains(&lower) {
            return Some(lower);
        }
    }
    None
}

// v1.1.3: tightened — see contacts::is_noreply_local for the rationale.
// The substring prefix forms were eating legitimate addresses like
// `no-reply-needed@…` and `noreplyforanother@…`.
fn is_noreply(addr: &str) -> bool {
    let local = addr.split('@').next().unwrap_or("");
    matches!(
        local,
        "noreply" | "no-reply" | "donotreply" | "do-not-reply" | "mailer-daemon" | "postmaster"
    )
}

fn load_events_by_email(
    db: &Db,
    start_ms: i64,
    end_ms: i64,
) -> Result<std::collections::HashMap<String, Vec<BundleEvent>>> {
    let mut out: std::collections::HashMap<String, Vec<BundleEvent>> =
        std::collections::HashMap::new();
    let mut stmt = db.conn().prepare(
        "SELECT id, title, start_ms, end_ms, all_day, location, attendees, organizer
         FROM calendar_events
         WHERE start_ms >= ? AND start_ms <= ?",
    )?;
    let rows = stmt.query_map(params![start_ms, end_ms], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, Option<String>>(7)?,
        ))
    })?;
    for row in rows {
        let (id, title, start, end, all_day_i, location, attendees_json, organizer) = row?;
        let ev = BundleEvent {
            id: id.clone(),
            title: title.clone(),
            start_ms: start,
            end_ms: end,
            all_day: all_day_i != 0,
            location: location.clone(),
        };
        let mut emails: std::collections::HashSet<String> = std::collections::HashSet::new();
        if let Some(o) = organizer { emails.insert(o.to_lowercase()); }
        if let Some(aj) = attendees_json {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&aj) {
                for v in arr {
                    if let Some(e) = v.get("email").and_then(|x| x.as_str()) {
                        emails.insert(e.to_lowercase());
                    }
                }
            }
        }
        for e in emails {
            out.entry(e).or_default().push(ev.clone());
        }
    }
    Ok(out)
}
