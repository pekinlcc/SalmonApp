//! Tauri commands for the mail UI (alpha.2: Gmail only, read-only).
//!
//! The frontend flow for "+ 添加 Gmail":
//!
//! 1. FE calls `start_gmail_oauth` — this returns immediately with an auth
//!    URL the FE opens in the system browser. The backend has already
//!    started a localhost callback server.
//! 2. User logs in / consents in the browser; Google redirects to
//!    `http://127.0.0.1:<port>/oauth/callback`; the server captures the
//!    code, exchanges it for tokens, fetches user identity, and writes a
//!    `mail_accounts` row.
//! 3. FE polls `list_mail_accounts` (or listens for a `salmon-mail-accounts`
//!    event) to detect the new row and refresh its account list.
//!
//! Sync isn't automatic — the FE invokes `sync_account_inbox` after the
//! new account appears (or on user pressing 重新同步).

use crate::mail_sync;
use crate::oauth;
use crate::AppState;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

fn map_err<E: std::fmt::Display>(e: E) -> String {
    format!("{e}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccountRow {
    pub id: String,
    pub provider: String,
    pub email: String,
    pub display_name: Option<String>,
    pub added_at: i64,
    pub last_sync_at: Option<i64>,
    pub last_sync_error: Option<String>,
    pub unread_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailListRow {
    pub id: String,
    pub account_id: String,
    pub thread_id: Option<String>,
    pub from_email: Option<String>,
    pub from_name: Option<String>,
    pub subject: Option<String>,
    pub snippet: Option<String>,
    pub date_ms: i64,
    pub unread: bool,
    pub starred: bool,
    pub has_attachments: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailMessageFull {
    pub id: String,
    pub account_id: String,
    pub thread_id: Option<String>,
    pub from_email: Option<String>,
    pub from_name: Option<String>,
    pub to_emails: serde_json::Value,
    pub cc_emails: serde_json::Value,
    pub subject: Option<String>,
    pub snippet: Option<String>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub date_ms: i64,
    pub unread: bool,
    pub starred: bool,
    pub labels: serde_json::Value,
    pub has_attachments: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthStatus {
    pub google_configured: bool,
    pub microsoft_configured: bool,
}

#[tauri::command]
pub fn get_oauth_status(state: State<'_, AppState>) -> OauthStatus {
    OauthStatus {
        google_configured: state.oauth_cfg.google_configured(),
        microsoft_configured: state.oauth_cfg.microsoft_configured(),
    }
}

#[tauri::command]
pub fn list_mail_accounts(state: State<'_, AppState>) -> Result<Vec<MailAccountRow>, String> {
    let db = state.db.lock();
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT a.id, a.provider, a.email, a.display_name, a.added_at,
                    a.last_sync_at, a.last_sync_error,
                    (SELECT COUNT(*) FROM mail_messages m
                       WHERE m.account_id = a.id AND m.unread = 1) AS unread_count
             FROM mail_accounts a
             ORDER BY a.added_at ASC",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MailAccountRow {
                id: r.get(0)?,
                provider: r.get(1)?,
                email: r.get(2)?,
                display_name: r.get(3)?,
                added_at: r.get(4)?,
                last_sync_at: r.get(5)?,
                last_sync_error: r.get(6)?,
                unread_count: r.get(7)?,
            })
        })
        .map_err(map_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_err)?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn start_gmail_oauth(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<MailAccountRow, String> {
    let cfg = state.oauth_cfg.clone();
    let broker = state.oauth_broker.clone();
    let db_arc = state.db.clone();

    if !cfg.google_configured() {
        return Err(
            "Google OAuth 未配置 — 把 client_id / client_secret 填进 oauth_config.toml 后重启 SalmonApp"
                .into(),
        );
    }

    let _ = app.emit("salmon-oauth-status", "starting");
    let result = oauth::run_google_oauth(&cfg, &broker)
        .await
        .map_err(map_err)?;
    let _ = app.emit("salmon-oauth-status", "finished");

    // Persist account + tokens. Email is the natural unique key per
    // provider (the schema's UNIQUE INDEX on (provider, email)). Re-add
    // of the same Gmail address refreshes the tokens in place.
    let account_id = uuid::Uuid::new_v4().to_string();
    let now_ms = chrono::Utc::now().timestamp_millis();
    {
        let mut db_guard = db_arc.lock();
        let conn = db_guard.conn_mut();
        conn.execute(
            "INSERT INTO mail_accounts
               (id, provider, email, display_name, oauth_refresh_enc,
                oauth_access, oauth_expires_at, added_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(provider, email) DO UPDATE SET
               display_name = excluded.display_name,
               oauth_refresh_enc = excluded.oauth_refresh_enc,
               oauth_access = excluded.oauth_access,
               oauth_expires_at = excluded.oauth_expires_at,
               last_sync_error = NULL",
            rusqlite::params![
                account_id,
                "gmail",
                result.userinfo.email,
                result.userinfo.name,
                result.tokens.refresh_token,
                result.tokens.access_token,
                result.tokens.expires_at_ms,
                now_ms,
            ],
        )
        .map_err(map_err)?;
    }

    // Pull the stored row back so the FE has the canonical id (re-add
    // collides with the existing row via ON CONFLICT and keeps that id).
    let accounts = fetch_accounts(&db_arc)?;
    let row = accounts
        .into_iter()
        .find(|a| a.email == result.userinfo.email && a.provider == "gmail")
        .ok_or_else(|| "stored account row not found after insert".to_string())?;

    let _ = app.emit("salmon-mail-accounts", ());
    Ok(row)
}

#[tauri::command]
pub async fn start_outlook_oauth(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<MailAccountRow, String> {
    let cfg = state.oauth_cfg.clone();
    let broker = state.oauth_broker.clone();
    let db_arc = state.db.clone();

    if !cfg.microsoft_configured() {
        return Err("Microsoft OAuth 未配置".into());
    }

    let _ = app.emit("salmon-oauth-status", "starting");
    let result = crate::microsoft::run_microsoft_oauth(&cfg, &broker)
        .await
        .map_err(map_err)?;
    let _ = app.emit("salmon-oauth-status", "finished");

    let account_id = uuid::Uuid::new_v4().to_string();
    let now_ms = chrono::Utc::now().timestamp_millis();
    {
        let mut db_guard = db_arc.lock();
        let conn = db_guard.conn_mut();
        conn.execute(
            "INSERT INTO mail_accounts
               (id, provider, email, display_name, oauth_refresh_enc,
                oauth_access, oauth_expires_at, added_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(provider, email) DO UPDATE SET
               display_name = excluded.display_name,
               oauth_refresh_enc = excluded.oauth_refresh_enc,
               oauth_access = excluded.oauth_access,
               oauth_expires_at = excluded.oauth_expires_at,
               last_sync_error = NULL",
            rusqlite::params![
                account_id,
                "outlook",
                result.userinfo.email,
                result.userinfo.name,
                result.tokens.refresh_token,
                result.tokens.access_token,
                result.tokens.expires_at_ms,
                now_ms,
            ],
        )
        .map_err(map_err)?;
    }

    let accounts = fetch_accounts(&db_arc)?;
    let row = accounts
        .into_iter()
        .find(|a| a.email == result.userinfo.email && a.provider == "outlook")
        .ok_or_else(|| "stored account row not found".to_string())?;
    let _ = app.emit("salmon-mail-accounts", ());
    Ok(row)
}

fn fetch_accounts(
    db: &std::sync::Arc<parking_lot::Mutex<crate::db::Db>>,
) -> Result<Vec<MailAccountRow>, String> {
    let db_guard = db.lock();
    let mut stmt = db_guard
        .conn()
        .prepare(
            "SELECT a.id, a.provider, a.email, a.display_name, a.added_at,
                    a.last_sync_at, a.last_sync_error,
                    (SELECT COUNT(*) FROM mail_messages m
                       WHERE m.account_id = a.id AND m.unread = 1) AS unread_count
             FROM mail_accounts a
             ORDER BY a.added_at ASC",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MailAccountRow {
                id: r.get(0)?,
                provider: r.get(1)?,
                email: r.get(2)?,
                display_name: r.get(3)?,
                added_at: r.get(4)?,
                last_sync_at: r.get(5)?,
                last_sync_error: r.get(6)?,
                unread_count: r.get(7)?,
            })
        })
        .map_err(map_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_err)?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn sync_mail_account(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: String,
) -> Result<usize, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    mail_sync::sync_account_inbox(app, &cfg, db, &account_id)
        .await
        .map_err(map_err)
}

/// v0.10.3: list mail to/from a specific contact across an account.
/// Powers the "click contact → show their thread" panel in MailView's
/// contacts pane. Matches both inbound (from_email = email) and outbound
/// (to_emails contains email).
#[tauri::command]
pub fn list_contact_mail(
    state: State<'_, AppState>,
    account_id: String,
    email: String,
    limit: Option<i64>,
) -> Result<Vec<MailListRow>, String> {
    let db = state.db.lock();
    let limit = limit.unwrap_or(50).max(1).min(500);
    let email_lc = email.to_lowercase();
    let to_like = format!("%\"{}\"%", email_lc);
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT id, account_id, thread_id, from_email, from_name, subject,
                    snippet, date_ms, unread, starred, has_attachments
             FROM mail_messages
             WHERE account_id = ?
               AND (lower(COALESCE(from_email, '')) = ?
                    OR lower(COALESCE(to_emails, '')) LIKE ? ESCAPE '\\')
             ORDER BY date_ms DESC
             LIMIT ?",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(rusqlite::params![account_id, email_lc, to_like, limit], |r| {
            Ok(MailListRow {
                id: r.get(0)?,
                account_id: r.get(1)?,
                thread_id: r.get(2)?,
                from_email: r.get(3)?,
                from_name: r.get(4)?,
                subject: r.get(5)?,
                snippet: r.get(6)?,
                date_ms: r.get(7)?,
                unread: r.get::<_, i64>(8)? != 0,
                starred: r.get::<_, i64>(9)? != 0,
                has_attachments: r.get::<_, i64>(10)? != 0,
            })
        })
        .map_err(map_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_err)?);
    }
    Ok(out)
}

/// v0.10.3: return pending Pulse brief_items where this contact is the
/// counter-party. The Pulse pipeline already analyses by contact; this
/// just surfaces those rows on the contact-detail panel.
///
/// v1.1.4: now ALSO scopes to the current briefing run (matches what
/// `list_brief_items` has always done). Without this scope, pending
/// items from previous Briefing runs that didn't get superseded (e.g.
/// installs that pre-date v1.1.3's supersede-after-write fix, or runs
/// from before v1.1.1 added the per-contact item cap) all surfaced on
/// the contact detail panel — surfacing as "this contact has 12 cards
/// for 2 emails" while the Home view (which already filtered correctly)
/// showed sane counts for the same data.
#[tauri::command]
pub fn list_contact_brief_items(
    state: State<'_, AppState>,
    email: String,
) -> Result<Vec<crate::briefing_commands::BriefItem>, String> {
    let db = state.db.lock();
    let current_bid: String = db
        .conn()
        .query_row(
            "SELECT briefing_id FROM briefing_state WHERE key='current'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default();
    if current_bid.is_empty() {
        return Ok(Vec::new());
    }
    let email_lc = email.to_lowercase();
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT id, briefing_id, kind, priority, title, summary, why,
                    contact_email, topic_id, related_mail_ids, related_topic_ids,
                    related_event_ids, suggested_actions, status, score,
                    created_at, decided_at
             FROM brief_items
             WHERE lower(COALESCE(contact_email, '')) = ?
               AND status = 'pending'
               AND briefing_id = ?
             ORDER BY score DESC, created_at DESC
             LIMIT 30",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(rusqlite::params![email_lc, current_bid], |r| {
            let rmids: String = r.get::<_, Option<String>>(9)?.unwrap_or_else(|| "[]".into());
            let rtids: String = r.get::<_, Option<String>>(10)?.unwrap_or_else(|| "[]".into());
            let reids: String = r.get::<_, Option<String>>(11)?.unwrap_or_else(|| "[]".into());
            let actions_json: String = r.get(12)?;
            Ok(crate::briefing_commands::BriefItem {
                id: r.get(0)?,
                briefing_id: r.get(1)?,
                kind: r.get(2)?,
                priority: r.get(3)?,
                title: r.get(4)?,
                summary: r.get(5)?,
                why: r.get(6)?,
                contact_email: r.get(7)?,
                topic_id: r.get(8)?,
                related_mail_ids: serde_json::from_str(&rmids).unwrap_or_default(),
                related_topic_ids: serde_json::from_str(&rtids).unwrap_or_default(),
                related_event_ids: serde_json::from_str(&reids).unwrap_or_default(),
                suggested_actions: serde_json::from_str(&actions_json).unwrap_or_default(),
                status: r.get(13)?,
                score: r.get(14)?,
                created_at: r.get(15)?,
                decided_at: r.get(16)?,
            })
        })
        .map_err(map_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn list_inbox_messages(
    state: State<'_, AppState>,
    account_id: String,
    limit: Option<i64>,
) -> Result<Vec<MailListRow>, String> {
    let db = state.db.lock();
    let limit = limit.unwrap_or(200).max(1).min(2000);
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT id, account_id, thread_id, from_email, from_name, subject,
                    snippet, date_ms, unread, starred, has_attachments
             FROM mail_messages
             WHERE account_id = ?
             ORDER BY date_ms DESC
             LIMIT ?",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(rusqlite::params![account_id, limit], |r| {
            Ok(MailListRow {
                id: r.get(0)?,
                account_id: r.get(1)?,
                thread_id: r.get(2)?,
                from_email: r.get(3)?,
                from_name: r.get(4)?,
                subject: r.get(5)?,
                snippet: r.get(6)?,
                date_ms: r.get(7)?,
                unread: r.get::<_, i64>(8)? != 0,
                starred: r.get::<_, i64>(9)? != 0,
                has_attachments: r.get::<_, i64>(10)? != 0,
            })
        })
        .map_err(map_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_err)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_mail_message(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<MailMessageFull, String> {
    let db = state.db.lock();
    let row = db
        .conn()
        .query_row(
            "SELECT id, account_id, thread_id, from_email, from_name,
                    to_emails, cc_emails, subject, snippet, body_text, body_html,
                    date_ms, unread, starred, labels, has_attachments
             FROM mail_messages WHERE id = ?",
            rusqlite::params![message_id],
            |r| {
                let to_json: String = r.get::<_, Option<String>>(5)?.unwrap_or("[]".into());
                let cc_json: String = r.get::<_, Option<String>>(6)?.unwrap_or("[]".into());
                let labels_json: String = r.get::<_, Option<String>>(14)?.unwrap_or("[]".into());
                Ok(MailMessageFull {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    thread_id: r.get(2)?,
                    from_email: r.get(3)?,
                    from_name: r.get(4)?,
                    to_emails: serde_json::from_str(&to_json).unwrap_or(serde_json::json!([])),
                    cc_emails: serde_json::from_str(&cc_json).unwrap_or(serde_json::json!([])),
                    subject: r.get(7)?,
                    snippet: r.get(8)?,
                    body_text: r.get(9)?,
                    body_html: r.get(10)?,
                    date_ms: r.get(11)?,
                    unread: r.get::<_, i64>(12)? != 0,
                    starred: r.get::<_, i64>(13)? != 0,
                    labels: serde_json::from_str(&labels_json).unwrap_or(serde_json::json!([])),
                    has_attachments: r.get::<_, i64>(15)? != 0,
                })
            },
        )
        .map_err(map_err)?;
    Ok(row)
}

#[tauri::command]
pub fn delete_mail_account(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<(), String> {
    let mut db = state.db.lock();
    let tx = db.conn_mut().transaction().map_err(map_err)?;
    tx.execute(
        "DELETE FROM mail_attachments
         WHERE message_id IN (SELECT id FROM mail_messages WHERE account_id = ?)",
        rusqlite::params![&account_id],
    )
    .map_err(map_err)?;
    for table in ["mail_drafts", "calendar_events", "contacts", "tasks", "mail_messages"] {
        tx.execute(
            &format!("DELETE FROM {} WHERE account_id = ?", table),
            rusqlite::params![&account_id],
        )
        .map_err(map_err)?;
    }
    tx.execute(
        "DELETE FROM mail_accounts WHERE id = ?",
        rusqlite::params![&account_id],
    )
    .map_err(map_err)?;
    tx.commit().map_err(map_err)?;
    Ok(())
}

// ── alpha.3: send / draft / compose ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeInput {
    pub account_id: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_text: String,
    pub body_html: Option<String>,
    pub attachment_paths: Vec<String>,
    pub reply_to_message_id: Option<String>,
}

#[tauri::command]
pub async fn send_mail(
    state: State<'_, AppState>,
    input: ComposeInput,
) -> Result<String, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();

    // Load tokens + provider + sender identity for the account.
    let (provider, email, name, mut tokens) = load_account(&db, &input.account_id).map_err(map_err)?;
    // Refresh access if needed.
    if let Some(new) = maybe_refresh(&cfg, &provider, &mut tokens).await.map_err(map_err)? {
        persist(&db, &input.account_id, &new).map_err(map_err)?;
        tokens = new;
    }

    // Compose reply headers if this is a reply.
    let (in_reply_to, references, thread_id) =
        if let Some(parent_id) = &input.reply_to_message_id {
            reply_headers(&db, parent_id).unwrap_or((None, None, None))
        } else {
            (None, None, None)
        };

    let msg = crate::gmail_send::OutgoingMessage {
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        body_text: input.body_text,
        body_html: input.body_html,
        attachment_paths: input.attachment_paths,
        reply_to_message_id: input.reply_to_message_id,
        thread_id,
        references,
        in_reply_to,
        from_email: email,
        from_name: name,
    };

    match provider.as_str() {
        "gmail" => crate::gmail_send::send_message(&tokens, &msg)
            .await
            .map_err(map_err),
        "outlook" => crate::graph_send::send_message(&tokens, &msg)
            .await
            .map_err(map_err),
        other => Err(format!("send not implemented for provider {}", other)),
    }
}

#[tauri::command]
pub async fn save_mail_draft(
    state: State<'_, AppState>,
    input: ComposeInput,
    draft_id: Option<String>,
) -> Result<String, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    let (provider, email, name, mut tokens) = load_account(&db, &input.account_id).map_err(map_err)?;
    if let Some(new) = maybe_refresh(&cfg, &provider, &mut tokens).await.map_err(map_err)? {
        persist(&db, &input.account_id, &new).map_err(map_err)?;
        tokens = new;
    }
    let msg = crate::gmail_send::OutgoingMessage {
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        body_text: input.body_text,
        body_html: input.body_html,
        attachment_paths: input.attachment_paths,
        reply_to_message_id: input.reply_to_message_id,
        thread_id: None,
        references: None,
        in_reply_to: None,
        from_email: email,
        from_name: name,
    };
    match provider.as_str() {
        "gmail" => crate::gmail_send::save_draft(&tokens, &msg, draft_id.as_deref())
            .await
            .map_err(map_err),
        other => Err(format!("draft save not implemented for provider {}", other)),
    }
}

#[tauri::command]
pub async fn mark_mail_read(
    state: State<'_, AppState>,
    message_id: String,
    read: bool,
) -> Result<(), String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    // Look up the account for this message.
    let account_id: Option<String> = {
        let db_guard = db.lock();
        db_guard
            .conn()
            .query_row(
                "SELECT account_id FROM mail_messages WHERE id = ?",
                rusqlite::params![message_id],
                |r| r.get::<_, String>(0),
            )
            .ok()
    };
    let account_id = account_id.ok_or_else(|| "message not found".to_string())?;
    let (provider, _email, _name, mut tokens) =
        load_account(&db, &account_id).map_err(map_err)?;
    if let Some(new) = maybe_refresh(&cfg, &provider, &mut tokens).await.map_err(map_err)? {
        persist(&db, &account_id, &new).map_err(map_err)?;
        tokens = new;
    }
    match provider.as_str() {
        "gmail" => {
            let (add, remove): (Vec<&str>, Vec<&str>) = if read {
                (vec![], vec!["UNREAD"])
            } else {
                (vec!["UNREAD"], vec![])
            };
            crate::gmail_send::modify_labels(&tokens, &message_id, &add, &remove)
                .await
                .map_err(map_err)?;
        }
        "outlook" => {
            crate::graph_send::mark_read(&tokens, &message_id, read)
                .await
                .map_err(map_err)?;
        }
        _ => return Err(format!("mark_read not implemented for {}", provider)),
    }
    // Update local DB to reflect.
    let db_guard = db.lock();
    db_guard
        .conn()
        .execute(
            "UPDATE mail_messages SET unread = ? WHERE id = ?",
            rusqlite::params![if read { 0 } else { 1 }, message_id],
        )
        .map_err(map_err)?;
    Ok(())
}

fn load_account(
    db: &std::sync::Arc<parking_lot::Mutex<crate::db::Db>>,
    account_id: &str,
) -> anyhow::Result<(String, String, Option<String>, oauth::OauthTokens)> {
    let guard = db.lock();
    let row = guard.conn().query_row(
        "SELECT provider, email, display_name, oauth_access, oauth_refresh_enc, oauth_expires_at
         FROM mail_accounts WHERE id = ?",
        rusqlite::params![account_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<i64>>(5)?,
            ))
        },
    )?;
    let (provider, email, name, access, refresh, expires) = row;
    let tokens = oauth::OauthTokens {
        access_token: access.unwrap_or_default(),
        refresh_token: refresh,
        expires_at_ms: expires.unwrap_or(0),
        token_type: "Bearer".to_string(),
        scope: None,
    };
    Ok((provider, email, name, tokens))
}

async fn maybe_refresh(
    cfg: &crate::oauth_config::OauthConfig,
    provider: &str,
    tokens: &mut oauth::OauthTokens,
) -> anyhow::Result<Option<oauth::OauthTokens>> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    if tokens.expires_at_ms - now_ms >= 60_000 {
        return Ok(None);
    }
    let Some(rt) = tokens.refresh_token.clone() else {
        return Err(anyhow::anyhow!("no refresh_token; re-login required"));
    };
    let new = match provider {
        "gmail" => oauth::refresh_google_access(cfg, &rt).await?,
        "outlook" => crate::microsoft::refresh_microsoft_access(cfg, &rt).await?,
        other => return Err(anyhow::anyhow!("refresh not impl for {}", other)),
    };
    Ok(Some(new))
}

fn persist(
    db: &std::sync::Arc<parking_lot::Mutex<crate::db::Db>>,
    account_id: &str,
    tokens: &oauth::OauthTokens,
) -> anyhow::Result<()> {
    let guard = db.lock();
    crate::mail_sync::persist_tokens(&guard, account_id, tokens)
}

// ── alpha.5: calendar ────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_calendar(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<usize, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    crate::calendar::sync_account_calendar(&cfg, db, &account_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn list_calendar_events(
    state: State<'_, AppState>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<crate::calendar::CalEvent>, String> {
    let db = state.db.lock();
    crate::calendar::list_events_window(&db, start_ms, end_ms).map_err(map_err)
}

#[tauri::command]
pub async fn create_calendar_event(
    state: State<'_, AppState>,
    input: crate::calendar::CreateEventInput,
) -> Result<crate::calendar::CalEvent, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    crate::calendar::create_event_remote(&cfg, db, input)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn delete_calendar_event(
    state: State<'_, AppState>,
    account_id: String,
    event_id: String,
) -> Result<(), String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    crate::calendar::delete_event_remote(&cfg, db, &account_id, &event_id)
        .await
        .map_err(map_err)
}

// ── v0.9.1 Tasks (Google Tasks + Microsoft Graph Todo) ──────────────

#[tauri::command]
pub async fn sync_tasks(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<usize, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    crate::tasks::sync_account_tasks(&cfg, db, &account_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn list_tasks(
    state: State<'_, AppState>,
    account_id: Option<String>,
    include_completed: Option<bool>,
) -> Result<Vec<crate::tasks::Task>, String> {
    let db = state.db.lock();
    crate::tasks::list_tasks_local(
        &db,
        account_id.as_deref(),
        include_completed.unwrap_or(true),
    )
    .map_err(map_err)
}

#[tauri::command]
pub async fn create_task(
    state: State<'_, AppState>,
    input: crate::tasks::CreateTaskInput,
) -> Result<crate::tasks::Task, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    crate::tasks::create_task_remote(&cfg, db, input)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn update_task(
    state: State<'_, AppState>,
    input: crate::tasks::UpdateTaskInput,
) -> Result<crate::tasks::Task, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    crate::tasks::update_task_remote(&cfg, db, input)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn delete_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    crate::tasks::delete_task_remote(&cfg, db, &task_id)
        .await
        .map_err(map_err)
}

// ── alpha.6: contacts ────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_contacts(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<usize, String> {
    let cfg = state.oauth_cfg.clone();
    let db = state.db.clone();
    crate::contacts::sync_account_contacts(&cfg, db, &account_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn list_contacts(
    state: State<'_, AppState>,
    account_id: Option<String>,
) -> Result<Vec<crate::contacts::ContactRow>, String> {
    let db = state.db.lock();
    crate::contacts::list_contacts(&db, account_id.as_deref()).map_err(map_err)
}

/// v1.1.1: batch lookup mail rows by id. Powers the inline-expand of
/// `related_mail_ids` on brief cards so the user can see (and click into)
/// the emails Pulse cited as evidence. Returns rows in the same order as
/// the input ids; missing ids are silently dropped (the mail might have
/// been deleted or fallen out of the local sync window).
#[tauri::command]
pub fn get_mail_messages_by_ids(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<MailListRow>, String> {
    if ids.is_empty() { return Ok(Vec::new()); }
    // Cap to avoid pathological SQL with 1000+ placeholders if a malformed
    // brief_item somehow stored an enormous related_mail_ids array.
    let ids: Vec<&str> = ids.iter().map(|s| s.as_str()).take(200).collect();
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, account_id, thread_id, from_email, from_name, subject,
                snippet, date_ms, unread, starred, has_attachments
         FROM mail_messages
         WHERE id IN ({})",
        placeholders
    );
    let db = state.db.lock();
    let mut stmt = db.conn().prepare(&sql).map_err(map_err)?;
    let params: Vec<&dyn rusqlite::ToSql> = ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();
    let rows = stmt
        .query_map(params.as_slice(), |r| {
            Ok(MailListRow {
                id: r.get(0)?,
                account_id: r.get(1)?,
                thread_id: r.get(2)?,
                from_email: r.get(3)?,
                from_name: r.get(4)?,
                subject: r.get(5)?,
                snippet: r.get(6)?,
                date_ms: r.get(7)?,
                unread: r.get::<_, i64>(8)? != 0,
                starred: r.get::<_, i64>(9)? != 0,
                has_attachments: r.get::<_, i64>(10)? != 0,
            })
        })
        .map_err(map_err)?;
    let mut by_id: std::collections::HashMap<String, MailListRow> =
        std::collections::HashMap::new();
    for row in rows {
        let r = row.map_err(map_err)?;
        by_id.insert(r.id.clone(), r);
    }
    let mut out: Vec<MailListRow> = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(row) = by_id.remove(*id) {
            out.push(row);
        }
    }
    Ok(out)
}

/// v1.1: union of saved contacts + counterparties seen in the last 30
/// days. Includes "strangers" (people we've emailed but haven't synced
/// from Google / Outlook), and carries pending Pulse brief_items counts
/// so the frontend can sort by ContactPulse priority.
#[tauri::command]
pub fn list_unified_contacts(
    state: State<'_, AppState>,
    account_id: Option<String>,
) -> Result<Vec<crate::contacts::UnifiedContact>, String> {
    let db = state.db.lock();
    crate::contacts::list_unified_contacts(&db, account_id.as_deref()).map_err(map_err)
}

/// v1.1: returns the Roost bundle for one contact — exactly what Pulse
/// gets fed (when it runs). Pure local query, no LLM. Lookback 30 days.
/// Returns None when there's been no mail traffic with this address in
/// the window (the Contacts view treats this as "no Roost data").
#[tauri::command]
pub fn get_contact_roost_bundle(
    state: State<'_, AppState>,
    email: String,
) -> Result<Option<crate::roost::ContactBundle>, String> {
    let db = state.db.lock();
    let bundles = crate::roost::build_bundles(
        &db,
        crate::roost::LOOKBACK_DAYS_DETAIL,
        Some(&email),
    )
    .map_err(map_err)?;
    Ok(bundles.into_iter().next())
}

#[tauri::command]
pub fn set_contact_vip(
    state: State<'_, AppState>,
    contact_id: String,
    vip: bool,
) -> Result<(), String> {
    let db = state.db.lock();
    crate::contacts::set_vip(&db, &contact_id, vip).map_err(map_err)
}

// ── alpha.6: home-feed briefing ──────────────────────────────────────

#[tauri::command]
pub fn build_home_feed(state: State<'_, AppState>) -> Result<crate::briefing::BriefingFeed, String> {
    let db = state.db.lock();
    crate::briefing::build_feed(&db).map_err(map_err)
}

fn reply_headers(
    db: &std::sync::Arc<parking_lot::Mutex<crate::db::Db>>,
    parent_id: &str,
) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let guard = db.lock();
    let row = guard
        .conn()
        .query_row(
            "SELECT thread_id, labels FROM mail_messages WHERE id = ?",
            rusqlite::params![parent_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .ok()?;
    let (thread_id, _labels) = row;
    // We don't currently store Message-ID headers on incoming messages; the
    // proper References chain requires that. For alpha.3 we just thread by
    // gmail thread_id, which keeps replies in the same Gmail conversation;
    // the In-Reply-To header is left None so the recipient's mail client
    // may not perfectly thread.
    // alpha.4+ will store rfc822 Message-ID on incoming messages and we'll
    // build full References here.
    Some((None, None, thread_id))
}
