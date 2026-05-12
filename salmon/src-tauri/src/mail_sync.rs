//! Sync orchestration: pull the latest 90 days (cap 1000 messages) from
//! Gmail into the local `mail_messages` table. Used by `sync_account`
//! both on first-add and on manual refresh.
//!
//! Strategy:
//! 1. Refresh the access_token if it's within 60s of expiry.
//! 2. `q=newer_than:90d in:inbox` to bound the window.
//! 3. List ids (cheap), filter to ones not already in DB.
//! 4. Fetch each new id in `get_message` (full body) — serially for now.
//! 5. Upsert into mail_messages; emit a Tauri event every 10 rows so the
//!    UI can render progressively without waiting for the whole sync.
//!
//! IMPORTANT: parking_lot::MutexGuard isn't Send and rusqlite::Connection
//! isn't either, so we cannot hold the DB lock across an `await`. Every
//! DB phase opens a short critical section, grabs / writes what it needs,
//! and drops the guard before any HTTP call. Sync is single-threaded
//! per-account; multiple accounts can sync in parallel.

use crate::db::Db;
use crate::gmail;
use crate::graph;
use crate::microsoft::refresh_microsoft_access;
use crate::oauth::{refresh_google_access, OauthTokens};
use crate::oauth_config::OauthConfig;
use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use rusqlite::params;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const SYNC_QUERY: &str = "newer_than:90d in:inbox";
const SYNC_MAX_MESSAGES: usize = 1000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub account_id: String,
    pub fetched: usize,
    pub total: usize,
    pub stage: String,
}

pub async fn sync_account_inbox(
    app: AppHandle,
    cfg: &OauthConfig,
    db: Arc<Mutex<Db>>,
    account_id: &str,
) -> Result<usize> {
    // 1. Load account + tokens (short DB hold).
    let (provider, email, mut tokens) = {
        let guard = db.lock();
        load_account_full(&guard, account_id)?
    };

    // 2. Ensure access token is fresh (HTTP — lock released). Provider-
    //    specific refresh; both shape the OauthTokens the same way.
    let now_ms = chrono::Utc::now().timestamp_millis();
    if tokens.expires_at_ms - now_ms < 60_000 {
        if let Some(refresh) = tokens.refresh_token.clone() {
            let new = match provider.as_str() {
                "gmail" => refresh_google_access(cfg, &refresh).await?,
                "outlook" => refresh_microsoft_access(cfg, &refresh).await?,
                other => return Err(anyhow!("sync not implemented for provider {}", other)),
            };
            tokens.access_token = new.access_token;
            tokens.expires_at_ms = new.expires_at_ms;
            if let Some(rt) = new.refresh_token {
                tokens.refresh_token = Some(rt);
            }
            {
                let guard = db.lock();
                persist_tokens(&guard, account_id, &tokens)?;
            }
        } else {
            return Err(anyhow!(
                "account {} has no refresh_token; re-login required",
                email
            ));
        }
    }

    let _ = app.emit(
        "salmon-mail-sync",
        SyncProgress {
            account_id: account_id.to_string(),
            fetched: 0,
            total: 0,
            stage: "listing".into(),
        },
    );

    // 3. List ids (HTTP — no lock held). Per-provider endpoints.
    let head_ids: Vec<String> = match provider.as_str() {
        "gmail" => gmail::list_message_ids(&tokens.access_token, SYNC_QUERY, SYNC_MAX_MESSAGES)
            .await
            .context("list message ids")?
            .into_iter()
            .map(|h| h.id)
            .collect(),
        "outlook" => graph::list_inbox_ids(&tokens.access_token, SYNC_MAX_MESSAGES)
            .await
            .context("graph list inbox")?,
        other => return Err(anyhow!("list not impl for {}", other)),
    };

    // 4. Diff against existing DB rows (short DB hold).
    let existing = {
        let guard = db.lock();
        existing_ids(&guard, account_id)?
    };
    let new_ids: Vec<String> = head_ids
        .into_iter()
        .filter(|id| !existing.contains(id))
        .collect();
    let new_total = new_ids.len();

    let _ = app.emit(
        "salmon-mail-sync",
        SyncProgress {
            account_id: account_id.to_string(),
            fetched: 0,
            total: new_total,
            stage: "fetching".into(),
        },
    );

    // 5. Fetch new messages one at a time, upserting as we go. HTTP call
    //    has no lock held; upsert opens/closes the lock in a single line.
    let mut fetched = 0usize;
    for head_id in new_ids {
        let fetch_result = match provider.as_str() {
            "gmail" => gmail::get_message(&tokens.access_token, &head_id).await,
            "outlook" => graph::get_message(&tokens.access_token, &head_id).await,
            _ => continue,
        };
        match fetch_result {
            Ok(msg) => {
                {
                    let guard = db.lock();
                    if let Err(e) = upsert_message(&guard, account_id, &msg) {
                        eprintln!("[salmon][mail-sync] upsert {} failed: {}", head_id, e);
                    }
                }
                fetched += 1;
                if fetched % 10 == 0 {
                    let _ = app.emit(
                        "salmon-mail-sync",
                        SyncProgress {
                            account_id: account_id.to_string(),
                            fetched,
                            total: new_total,
                            stage: "fetching".into(),
                        },
                    );
                }
            }
            Err(e) => {
                eprintln!("[salmon][mail-sync] get {} failed: {}", head_id, e);
            }
        }
    }

    // 6. Stamp last_sync_at.
    {
        let guard = db.lock();
        guard.conn().execute(
            "UPDATE mail_accounts SET last_sync_at = ?, last_sync_error = NULL WHERE id = ?",
            params![chrono::Utc::now().timestamp_millis(), account_id],
        )?;
    }

    let _ = app.emit(
        "salmon-mail-sync",
        SyncProgress {
            account_id: account_id.to_string(),
            fetched,
            total: new_total,
            stage: "done".into(),
        },
    );

    Ok(fetched)
}

fn load_account_full(
    db: &Db,
    account_id: &str,
) -> Result<(String, String, OauthTokens)> {
    let row: Option<(String, String, Option<String>, Option<String>, Option<i64>)> = db
        .conn()
        .query_row(
            "SELECT provider, email, oauth_access, oauth_refresh_enc, oauth_expires_at
             FROM mail_accounts WHERE id = ?",
            params![account_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .ok();
    let (provider, email, access, refresh, expires) =
        row.ok_or_else(|| anyhow!("account {} not found", account_id))?;
    let tokens = OauthTokens {
        access_token: access.unwrap_or_default(),
        refresh_token: refresh,
        expires_at_ms: expires.unwrap_or(0),
        token_type: "Bearer".to_string(),
        scope: None,
    };
    Ok((provider, email, tokens))
}

pub fn persist_tokens(db: &Db, account_id: &str, tokens: &OauthTokens) -> Result<()> {
    db.conn().execute(
        "UPDATE mail_accounts SET
           oauth_access = ?,
           oauth_refresh_enc = COALESCE(?, oauth_refresh_enc),
           oauth_expires_at = ?
         WHERE id = ?",
        params![
            tokens.access_token,
            tokens.refresh_token,
            tokens.expires_at_ms,
            account_id,
        ],
    )?;
    Ok(())
}

fn existing_ids(db: &Db, account_id: &str) -> Result<std::collections::HashSet<String>> {
    let mut stmt = db
        .conn()
        .prepare("SELECT id FROM mail_messages WHERE account_id = ?")?;
    let rows = stmt.query_map(params![account_id], |r| r.get::<_, String>(0))?;
    let mut set = std::collections::HashSet::new();
    for r in rows {
        set.insert(r?);
    }
    Ok(set)
}

fn upsert_message(db: &Db, account_id: &str, m: &gmail::GmailMessage) -> Result<()> {
    let to_json = serde_json::to_string(&m.to)?;
    let cc_json = serde_json::to_string(&m.cc)?;
    let labels_json = serde_json::to_string(&m.label_ids)?;
    let unread = if m.label_ids.iter().any(|l| l == "UNREAD") { 1 } else { 0 };
    let starred = if m.label_ids.iter().any(|l| l == "STARRED") { 1 } else { 0 };
    db.conn().execute(
        "INSERT INTO mail_messages
           (id, account_id, thread_id, from_email, from_name, to_emails, cc_emails,
            subject, snippet, body_text, body_html, date_ms, unread, starred,
            labels, has_attachments)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           snippet=excluded.snippet,
           body_text=excluded.body_text,
           body_html=excluded.body_html,
           unread=excluded.unread,
           starred=excluded.starred,
           labels=excluded.labels",
        params![
            m.id,
            account_id,
            m.thread_id,
            m.from_email,
            m.from_name,
            to_json,
            cc_json,
            m.subject,
            m.snippet,
            m.body_text,
            m.body_html,
            m.internal_date_ms,
            unread,
            starred,
            labels_json,
            if m.has_attachments { 1 } else { 0 },
        ],
    )?;
    Ok(())
}
