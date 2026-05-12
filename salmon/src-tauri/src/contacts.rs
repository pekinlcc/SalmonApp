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
