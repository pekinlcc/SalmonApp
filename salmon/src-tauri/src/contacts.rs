//! Contacts sync — Google People API + Microsoft Graph /me/contacts.
//!
//! Stored in the `contacts` table, one row per (account_id, email). The
//! sync also derives interaction_count + last_seen_ms from the local
//! mail_messages table so the AI ranker has signal even on first run.

use crate::db::Db;
use crate::microsoft::refresh_microsoft_access;
use crate::oauth::{refresh_google_access, OauthTokens};
use crate::oauth_config::OauthConfig;
use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const PEOPLE_BASE: &str = "https://people.googleapis.com/v1";
const GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactRow {
    pub id: String,
    pub account_id: String,
    pub email: String,
    pub name: Option<String>,
    pub organization: Option<String>,
    pub is_vip: bool,
    pub last_seen_ms: Option<i64>,
    pub interaction_count: i64,
}

pub async fn sync_account_contacts(
    cfg: &OauthConfig,
    db: Arc<Mutex<Db>>,
    account_id: &str,
) -> Result<usize> {
    let (provider, mut tokens) = {
        let guard = db.lock();
        load_account(&guard, account_id)?
    };

    let now_ms = chrono::Utc::now().timestamp_millis();
    if tokens.expires_at_ms - now_ms < 60_000 {
        let rt = tokens
            .refresh_token
            .clone()
            .ok_or_else(|| anyhow!("contacts sync: no refresh_token; re-login required"))?;
        let new = match provider.as_str() {
            "gmail" => refresh_google_access(cfg, &rt).await?,
            "outlook" => refresh_microsoft_access(cfg, &rt).await?,
            _ => return Err(anyhow!("contacts sync not impl for {}", provider)),
        };
        tokens.access_token = new.access_token;
        tokens.expires_at_ms = new.expires_at_ms;
        if let Some(r) = new.refresh_token {
            tokens.refresh_token = Some(r);
        }
        let guard = db.lock();
        crate::mail_sync::persist_tokens(&guard, account_id, &tokens)?;
    }

    let people: Vec<RawContact> = match provider.as_str() {
        "gmail" => fetch_google_contacts(&tokens.access_token).await?,
        "outlook" => fetch_graph_contacts(&tokens.access_token).await?,
        _ => return Err(anyhow!("contacts fetch not impl for {}", provider)),
    };

    let n = people.len();
    {
        let guard = db.lock();
        for p in &people {
            upsert_contact(&guard, account_id, p)?;
        }
        // Derive interaction stats from the local mail_messages table.
        recompute_stats(&guard, account_id)?;
    }
    Ok(n)
}

#[derive(Debug, Clone)]
struct RawContact {
    email: String,
    name: Option<String>,
    organization: Option<String>,
}

async fn fetch_google_contacts(access: &str) -> Result<Vec<RawContact>> {
    // People API: /people/me/connections — paged. personFields needed.
    let mut out = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut url = format!(
            "{}/people/me/connections?personFields=emailAddresses,names,organizations&pageSize=200",
            PEOPLE_BASE
        );
        if let Some(tok) = &page_token {
            url.push_str("&pageToken=");
            url.push_str(&urlencoding::encode(tok));
        }
        let resp = reqwest::Client::new()
            .get(&url)
            .bearer_auth(access)
            .send()
            .await
            .context("google people list")?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("google people failed ({}): {}", status, text));
        }
        let v: serde_json::Value = serde_json::from_str(&text)?;
        if let Some(arr) = v.get("connections").and_then(|x| x.as_array()) {
            for p in arr {
                let name = p
                    .get("names")
                    .and_then(|x| x.as_array())
                    .and_then(|a| a.first())
                    .and_then(|n| n.get("displayName"))
                    .and_then(|x| x.as_str())
                    .map(String::from);
                let organization = p
                    .get("organizations")
                    .and_then(|x| x.as_array())
                    .and_then(|a| a.first())
                    .and_then(|o| o.get("name"))
                    .and_then(|x| x.as_str())
                    .map(String::from);
                if let Some(emails) = p.get("emailAddresses").and_then(|x| x.as_array()) {
                    for em in emails {
                        if let Some(addr) = em.get("value").and_then(|x| x.as_str()) {
                            out.push(RawContact {
                                email: addr.to_lowercase(),
                                name: name.clone(),
                                organization: organization.clone(),
                            });
                        }
                    }
                }
            }
        }
        page_token = v
            .get("nextPageToken")
            .and_then(|x| x.as_str())
            .map(String::from);
        if page_token.is_none() {
            break;
        }
    }
    Ok(out)
}

async fn fetch_graph_contacts(access: &str) -> Result<Vec<RawContact>> {
    let mut out = Vec::new();
    let mut next_link: Option<String> = Some(format!(
        "{}/me/contacts?$select=emailAddresses,displayName,companyName&$top=100",
        GRAPH_BASE
    ));
    while let Some(url) = next_link.take() {
        let resp = reqwest::Client::new()
            .get(&url)
            .bearer_auth(access)
            .send()
            .await
            .context("graph contacts list")?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("graph contacts failed ({}): {}", status, text));
        }
        let v: serde_json::Value = serde_json::from_str(&text)?;
        if let Some(arr) = v.get("value").and_then(|x| x.as_array()) {
            for c in arr {
                let name = c
                    .get("displayName")
                    .and_then(|x| x.as_str())
                    .map(String::from);
                let organization = c
                    .get("companyName")
                    .and_then(|x| x.as_str())
                    .map(String::from);
                if let Some(emails) = c.get("emailAddresses").and_then(|x| x.as_array()) {
                    for em in emails {
                        if let Some(addr) = em.get("address").and_then(|x| x.as_str()) {
                            out.push(RawContact {
                                email: addr.to_lowercase(),
                                name: name.clone(),
                                organization: organization.clone(),
                            });
                        }
                    }
                }
            }
        }
        next_link = v
            .get("@odata.nextLink")
            .and_then(|x| x.as_str())
            .map(String::from);
    }
    Ok(out)
}

fn load_account(db: &Db, account_id: &str) -> Result<(String, OauthTokens)> {
    let row = db.conn().query_row(
        "SELECT provider, oauth_access, oauth_refresh_enc, oauth_expires_at
         FROM mail_accounts WHERE id = ?",
        params![account_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<i64>>(3)?,
            ))
        },
    )?;
    let (provider, access, refresh, expires) = row;
    Ok((
        provider,
        OauthTokens {
            access_token: access.unwrap_or_default(),
            refresh_token: refresh,
            expires_at_ms: expires.unwrap_or(0),
            token_type: "Bearer".to_string(),
            scope: None,
        },
    ))
}

fn upsert_contact(db: &Db, account_id: &str, c: &RawContact) -> Result<()> {
    let id = format!("{}|{}", account_id, c.email);
    db.conn().execute(
        "INSERT INTO contacts (id, account_id, email, name, organization, is_vip,
                               last_seen_ms, interaction_count)
         VALUES (?, ?, ?, ?, ?, 0, NULL, 0)
         ON CONFLICT(account_id, email) DO UPDATE SET
           name = COALESCE(excluded.name, contacts.name),
           organization = COALESCE(excluded.organization, contacts.organization)",
        params![id, account_id, c.email, c.name, c.organization],
    )?;
    Ok(())
}

/// Walk mail_messages for this account, count each sender + recipient, and
/// fold the result back into the contacts table. Anyone we've exchanged
/// >= 8 messages with is auto-flagged VIP (user can untoggle).
fn recompute_stats(db: &Db, account_id: &str) -> Result<()> {
    // Build a counts map.
    let mut stats: std::collections::HashMap<String, (i64, i64)> =
        std::collections::HashMap::new();
    let mut stmt = db.conn().prepare(
        "SELECT from_email, date_ms, to_emails FROM mail_messages WHERE account_id = ?",
    )?;
    let rows = stmt.query_map(params![account_id], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (from, date, to_json) = row?;
        if let Some(fe) = from {
            let e = fe.to_lowercase();
            let entry = stats.entry(e).or_insert((0, 0));
            entry.0 += 1;
            entry.1 = entry.1.max(date);
        }
        if let Some(tj) = to_json {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&tj) {
                for v in arr {
                    if let Some(addr) = v.get("email").and_then(|x| x.as_str()) {
                        let e = addr.to_lowercase();
                        let entry = stats.entry(e).or_insert((0, 0));
                        entry.0 += 1;
                        entry.1 = entry.1.max(date);
                    }
                }
            }
        }
    }
    drop(stmt);

    for (email, (count, last)) in stats {
        let vip = if count >= 8 { 1 } else { 0 };
        // Upsert: contact may not exist yet (server-side address books are
        // incomplete; mail itself is the source of truth for "people I talk
        // to"). On conflict we update interaction stats but NEVER touch
        // is_vip — once a contact exists, only the explicit set_vip command
        // changes that flag. Otherwise a user who manually unsets VIP would
        // see it auto-reapplied on next sync.
        let id = format!("{}|{}", account_id, email);
        db.conn().execute(
            "INSERT INTO contacts
               (id, account_id, email, name, organization, is_vip, last_seen_ms, interaction_count)
             VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)
             ON CONFLICT(account_id, email) DO UPDATE SET
               last_seen_ms = excluded.last_seen_ms,
               interaction_count = excluded.interaction_count",
            params![id, account_id, email, vip, last, count],
        )?;
    }
    Ok(())
}

pub fn list_contacts(db: &Db, account_id: Option<&str>) -> Result<Vec<ContactRow>> {
    let (sql, has_filter) = if account_id.is_some() {
        (
            "SELECT id, account_id, email, name, organization, is_vip, last_seen_ms, interaction_count
             FROM contacts WHERE account_id = ?
             ORDER BY is_vip DESC, interaction_count DESC, last_seen_ms DESC NULLS LAST
             LIMIT 500",
            true,
        )
    } else {
        (
            "SELECT id, account_id, email, name, organization, is_vip, last_seen_ms, interaction_count
             FROM contacts
             ORDER BY is_vip DESC, interaction_count DESC, last_seen_ms DESC NULLS LAST
             LIMIT 500",
            false,
        )
    };
    let map_row = |r: &rusqlite::Row| {
        Ok(ContactRow {
            id: r.get(0)?,
            account_id: r.get(1)?,
            email: r.get(2)?,
            name: r.get(3)?,
            organization: r.get(4)?,
            is_vip: r.get::<_, i64>(5)? != 0,
            last_seen_ms: r.get(6)?,
            interaction_count: r.get(7)?,
        })
    };
    let mut stmt = db.conn().prepare(sql)?;
    let rows: Vec<ContactRow> = if has_filter {
        stmt.query_map(params![account_id.unwrap()], map_row)?
            .collect::<rusqlite::Result<_>>()?
    } else {
        stmt.query_map([], map_row)?
            .collect::<rusqlite::Result<_>>()?
    };
    Ok(rows)
}

pub fn set_vip(db: &Db, contact_id: &str, vip: bool) -> Result<()> {
    db.conn().execute(
        "UPDATE contacts SET is_vip = ? WHERE id = ?",
        params![if vip { 1 } else { 0 }, contact_id],
    )?;
    Ok(())
}

// ── Unified contacts view (v1.1) ───────────────────────────────────────
//
// `list_contacts` (above) returns only rows synced from Google People /
// Microsoft Graph — anyone who emailed but isn't in the synced address
// book is invisible. The Contacts tab needs to surface those "strangers"
// as first-class contacts too, sorted by ContactPulse priority.
//
// `list_unified_contacts` does the union: saved contacts ∪ counterparties
// observed in `mail_messages` within the last 30 days. Each row also
// carries the pending brief_items count broken down by priority so the
// frontend can compute a sort score without a second round-trip.

const UNIFIED_LOOKBACK_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedContact {
    /// For saved contacts: the `contacts.id` row id. For email-derived
    /// strangers: `stranger:<lowercased_email>` — stable across calls so
    /// React list keys stay consistent.
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub organization: Option<String>,
    pub is_vip: bool,
    /// True when this email matches a row in the `contacts` table. False
    /// when reconstructed purely from observed mail traffic.
    pub is_saved: bool,
    pub last_seen_ms: Option<i64>,
    pub interaction_count: i64,
    /// For saved: the matching contacts.account_id. None for strangers.
    pub account_id: Option<String>,
    pub brief_high: i64,
    pub brief_medium: i64,
    pub brief_low: i64,
}

pub fn list_unified_contacts(
    db: &Db,
    account_id: Option<&str>,
) -> Result<Vec<UnifiedContact>> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let cutoff = now_ms - UNIFIED_LOOKBACK_DAYS * 86400_000;
    let own_addrs = load_own_addresses_local(db)?;

    // 1) Saved contacts → map by lowercased email. Multiple rows can share
    //    an email (same person in two account address books); collapse to
    //    one entry per email, preferring VIP/larger-interaction/latest.
    let mut saved: std::collections::HashMap<String, SavedRow> =
        std::collections::HashMap::new();
    let (sql, has_filter) = if account_id.is_some() {
        (
            "SELECT id, account_id, lower(email), name, organization, is_vip,
                    last_seen_ms, interaction_count
             FROM contacts WHERE account_id = ?",
            true,
        )
    } else {
        (
            "SELECT id, account_id, lower(email), name, organization, is_vip,
                    last_seen_ms, interaction_count
             FROM contacts",
            false,
        )
    };
    {
        let mut stmt = db.conn().prepare(sql)?;
        let map_row = |r: &rusqlite::Row| -> rusqlite::Result<SavedRow> {
            Ok(SavedRow {
                id: r.get(0)?,
                account_id: r.get(1)?,
                email_lc: r.get(2)?,
                name: r.get(3)?,
                organization: r.get(4)?,
                is_vip: r.get::<_, i64>(5)? != 0,
                last_seen_ms: r.get(6)?,
                interaction_count: r.get(7)?,
            })
        };
        let rows: Vec<SavedRow> = if has_filter {
            stmt.query_map(params![account_id.unwrap()], map_row)?
                .collect::<rusqlite::Result<_>>()?
        } else {
            stmt.query_map([], map_row)?
                .collect::<rusqlite::Result<_>>()?
        };
        for row in rows {
            match saved.get_mut(&row.email_lc) {
                None => {
                    saved.insert(row.email_lc.clone(), row);
                }
                Some(existing) => {
                    if !existing.is_vip && row.is_vip { existing.is_vip = true; }
                    if row.interaction_count > existing.interaction_count {
                        existing.interaction_count = row.interaction_count;
                    }
                    if row.last_seen_ms.unwrap_or(0) > existing.last_seen_ms.unwrap_or(0) {
                        existing.last_seen_ms = row.last_seen_ms;
                    }
                    if existing.name.is_none() { existing.name = row.name.clone(); }
                    if existing.organization.is_none() { existing.organization = row.organization.clone(); }
                }
            }
        }
    }

    // 2) Walk mail_messages within the 30-day window to enumerate every
    //    counterparty email — including ones never synced into `contacts`
    //    (the "stranger" case the user wants surfaced).
    let mut cps: std::collections::HashMap<String, CounterpartyStat> =
        std::collections::HashMap::new();
    {
        let (mail_sql, has_acct) = if account_id.is_some() {
            (
                "SELECT from_email, from_name, to_emails, date_ms
                 FROM mail_messages
                 WHERE date_ms >= ? AND account_id = ?",
                true,
            )
        } else {
            (
                "SELECT from_email, from_name, to_emails, date_ms
                 FROM mail_messages
                 WHERE date_ms >= ?",
                false,
            )
        };
        let mut stmt = db.conn().prepare(mail_sql)?;
        let map_row = |r: &rusqlite::Row| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
            ))
        };
        let rows: Vec<(Option<String>, Option<String>, Option<String>, i64)> = if has_acct {
            stmt.query_map(params![cutoff, account_id.unwrap()], map_row)?
                .collect::<rusqlite::Result<_>>()?
        } else {
            stmt.query_map(params![cutoff], map_row)?
                .collect::<rusqlite::Result<_>>()?
        };
        for (from_email, from_name, to_json, date_ms) in rows {
            let from_lc = from_email.as_deref().map(|s| s.to_lowercase());
            let from_me = from_lc.as_ref().map(|e| own_addrs.contains(e)).unwrap_or(false);
            if from_me {
                // Outbound: each external to-recipient is a counterparty.
                for (email_lc, name) in parse_external_recipients(&to_json, &own_addrs) {
                    if is_noreply_local(&email_lc) { continue }
                    bump_counterparty(&mut cps, &email_lc, date_ms, name);
                }
            } else if let Some(email_lc) = from_lc {
                if !is_noreply_local(&email_lc) && !own_addrs.contains(&email_lc) {
                    bump_counterparty(&mut cps, &email_lc, date_ms, from_name);
                }
            }
        }
    }

    // 3) Pending brief_items per email per priority.
    let mut briefs: std::collections::HashMap<String, (i64, i64, i64)> =
        std::collections::HashMap::new();
    {
        let mut stmt = db.conn().prepare(
            "SELECT lower(COALESCE(contact_email, '')), priority
             FROM brief_items
             WHERE status = 'pending' AND contact_email IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (email_lc, prio) = row?;
            if email_lc.is_empty() { continue }
            let e = briefs.entry(email_lc).or_insert((0, 0, 0));
            match prio.as_str() {
                "high"   => e.0 += 1,
                "medium" => e.1 += 1,
                "low"    => e.2 += 1,
                _        => {}
            }
        }
    }

    // 4) Merge — union of saved ∪ counterparty emails.
    let mut all: std::collections::HashSet<String> = std::collections::HashSet::new();
    for k in saved.keys() { all.insert(k.clone()); }
    for k in cps.keys() { all.insert(k.clone()); }

    let mut out: Vec<UnifiedContact> = Vec::with_capacity(all.len());
    for email_lc in all {
        if own_addrs.contains(&email_lc) || is_noreply_local(&email_lc) { continue }
        let s = saved.get(&email_lc);
        let cp = cps.get(&email_lc);
        let b = briefs.get(&email_lc).copied().unwrap_or((0, 0, 0));

        // Prefer saved interaction_count (cumulative) over the 30-day
        // window count when both exist. For strangers we only have the
        // window count.
        let interaction_count = s
            .map(|x| x.interaction_count)
            .or_else(|| cp.map(|x| x.interactions))
            .unwrap_or(0);
        let last_seen_ms = s
            .and_then(|x| x.last_seen_ms)
            .or_else(|| cp.and_then(|x| x.last_seen_ms))
            .filter(|v| *v > 0);

        out.push(UnifiedContact {
            id: s.map(|x| x.id.clone()).unwrap_or_else(|| format!("stranger:{}", email_lc)),
            email: email_lc.clone(),
            name: s.and_then(|x| x.name.clone()).or_else(|| cp.and_then(|x| x.name.clone())),
            organization: s.and_then(|x| x.organization.clone()),
            is_vip: s.map(|x| x.is_vip).unwrap_or(false),
            is_saved: s.is_some(),
            last_seen_ms,
            interaction_count,
            account_id: s.map(|x| x.account_id.clone()),
            brief_high: b.0,
            brief_medium: b.1,
            brief_low: b.2,
        });
    }
    Ok(out)
}

#[derive(Clone)]
struct SavedRow {
    id: String,
    account_id: String,
    email_lc: String,
    name: Option<String>,
    organization: Option<String>,
    is_vip: bool,
    last_seen_ms: Option<i64>,
    interaction_count: i64,
}

struct CounterpartyStat {
    interactions: i64,
    last_seen_ms: Option<i64>,
    name: Option<String>,
}

fn bump_counterparty(
    cps: &mut std::collections::HashMap<String, CounterpartyStat>,
    email_lc: &str,
    date_ms: i64,
    name: Option<String>,
) {
    let e = cps.entry(email_lc.to_string()).or_insert(CounterpartyStat {
        interactions: 0,
        last_seen_ms: None,
        name: None,
    });
    e.interactions += 1;
    e.last_seen_ms = Some(e.last_seen_ms.map(|x| x.max(date_ms)).unwrap_or(date_ms));
    if e.name.is_none() && name.is_some() {
        e.name = name;
    }
}

fn parse_external_recipients(
    to_json: &Option<String>,
    own: &std::collections::HashSet<String>,
) -> Vec<(String, Option<String>)> {
    let raw = match to_json.as_deref() { Some(s) => s, None => return vec![] };
    let arr: Vec<serde_json::Value> = match serde_json::from_str(raw) {
        Ok(a) => a,
        Err(_) => return vec![],
    };
    let mut out = vec![];
    for v in arr {
        if let Some(email) = v.get("email").and_then(|x| x.as_str()) {
            let email_lc = email.to_lowercase();
            if own.contains(&email_lc) { continue }
            let name = v.get("name").and_then(|x| x.as_str()).map(String::from);
            out.push((email_lc, name));
        }
    }
    out
}

// Duplicated from roost.rs to avoid making private helpers pub. Both
// modules have the same notion of "noreply" / "own address".
// v1.1.3: drop the substring prefix forms (`starts_with("noreply")`,
// `starts_with("no-reply")`) — they over-matched real human addresses
// like `no-reply-needed@…` or `noreplyforanother@…` and silently hid
// those people from both the Contacts view and the Pulse pipeline.
// The exact-match list still catches the canonical noreply spellings.
fn is_noreply_local(addr: &str) -> bool {
    let local = addr.split('@').next().unwrap_or("");
    matches!(
        local,
        "noreply" | "no-reply" | "donotreply" | "do-not-reply" | "mailer-daemon" | "postmaster"
    )
}

fn load_own_addresses_local(db: &Db) -> Result<std::collections::HashSet<String>> {
    let mut out = std::collections::HashSet::new();
    let mut stmt = db.conn().prepare("SELECT email FROM mail_accounts")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    for row in rows {
        out.insert(row?.to_lowercase());
    }
    Ok(out)
}
