//! Tasks — local cache + sync with Google Tasks API and Microsoft Graph
//! To Do API. CRUD operations write through to cloud, then mirror locally.
//!
//! For simplicity v0.9.1 always uses the user's **default** task list
//! (`@default` for Google; the first list returned by `/me/todo/lists`
//! for Graph). Multi-list selection is a future polish.

use crate::db::Db;
use crate::microsoft::refresh_microsoft_access;
use crate::oauth::{refresh_google_access, OauthTokens};
use crate::oauth_config::OauthConfig;
use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const GOOGLE_TASKS_BASE: &str = "https://tasks.googleapis.com/tasks/v1";
const GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub account_id: String,
    pub list_id: Option<String>,
    pub title: String,
    pub notes: Option<String>,
    pub due_ms: Option<i64>,
    pub completed: bool,
    pub completed_at_ms: Option<i64>,
    pub source_kind: String,
    pub source_brief_item_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub account_id: String,
    pub title: String,
    pub notes: Option<String>,
    pub due_ms: Option<i64>,
    #[serde(default)]
    pub source_kind: Option<String>,
    #[serde(default)]
    pub source_brief_item_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub id: String,
    pub completed: Option<bool>,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub due_ms: Option<i64>,
}

// ── Local DB ────────────────────────────────────────────────────────

pub fn list_tasks_local(
    db: &Db,
    account_id: Option<&str>,
    include_completed: bool,
) -> Result<Vec<Task>> {
    let mut sql = String::from(
        "SELECT id, account_id, list_id, title, notes, due_ms, completed,
                completed_at_ms, source_kind, source_brief_item_id,
                created_at, updated_at
         FROM tasks WHERE 1=1",
    );
    if account_id.is_some() {
        sql.push_str(" AND account_id = ?");
    }
    if !include_completed {
        sql.push_str(" AND completed = 0");
    }
    // Sort: incomplete first, by due (NULLs last) then by created.
    sql.push_str(
        " ORDER BY completed ASC,
                   CASE WHEN due_ms IS NULL THEN 1 ELSE 0 END ASC,
                   due_ms ASC,
                   created_at DESC",
    );
    let mut stmt = db.conn().prepare(&sql)?;
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<Task> {
        Ok(Task {
            id: r.get(0)?,
            account_id: r.get(1)?,
            list_id: r.get(2)?,
            title: r.get(3)?,
            notes: r.get(4)?,
            due_ms: r.get(5)?,
            completed: r.get::<_, i64>(6)? != 0,
            completed_at_ms: r.get(7)?,
            source_kind: r.get(8)?,
            source_brief_item_id: r.get(9)?,
            created_at: r.get(10)?,
            updated_at: r.get(11)?,
        })
    };
    let rows: Vec<Task> = if let Some(a) = account_id {
        stmt.query_map(params![a], map_row)?
            .collect::<rusqlite::Result<_>>()?
    } else {
        stmt.query_map([], map_row)?.collect::<rusqlite::Result<_>>()?
    };
    Ok(rows)
}

fn upsert_task_local(db: &Db, t: &Task) -> Result<()> {
    db.conn().execute(
        "INSERT INTO tasks
           (id, account_id, list_id, title, notes, due_ms, completed,
            completed_at_ms, source_kind, source_brief_item_id,
            created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           notes = excluded.notes,
           due_ms = excluded.due_ms,
           completed = excluded.completed,
           completed_at_ms = excluded.completed_at_ms,
           updated_at = excluded.updated_at,
           list_id = excluded.list_id",
        params![
            t.id, t.account_id, t.list_id, t.title, t.notes,
            t.due_ms, if t.completed { 1 } else { 0 },
            t.completed_at_ms, t.source_kind, t.source_brief_item_id,
            t.created_at, t.updated_at,
        ],
    )?;
    Ok(())
}

fn delete_task_local(db: &Db, task_id: &str) -> Result<()> {
    db.conn().execute("DELETE FROM tasks WHERE id = ?", params![task_id])?;
    Ok(())
}

// ── Token plumbing (same shape as calendar.rs) ─────────────────────

async fn ensure_access(
    cfg: &OauthConfig,
    db: &Arc<Mutex<Db>>,
    account_id: &str,
) -> Result<(String, OauthTokens)> {
    let (provider, mut tokens) = {
        let guard = db.lock();
        load_account(&guard, account_id)?
    };
    let now_ms = chrono::Utc::now().timestamp_millis();
    if tokens.expires_at_ms - now_ms < 60_000 {
        let rt = tokens
            .refresh_token
            .clone()
            .ok_or_else(|| anyhow!("no refresh_token for tasks"))?;
        let new = match provider.as_str() {
            "gmail" => refresh_google_access(cfg, &rt).await?,
            "outlook" => refresh_microsoft_access(cfg, &rt).await?,
            _ => return Err(anyhow!("tasks not impl for {}", provider)),
        };
        tokens.access_token = new.access_token;
        tokens.expires_at_ms = new.expires_at_ms;
        if let Some(r) = new.refresh_token {
            tokens.refresh_token = Some(r);
        }
        let guard = db.lock();
        crate::mail_sync::persist_tokens(&guard, account_id, &tokens)?;
    }
    Ok((provider, tokens))
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
            token_type: "Bearer".into(),
            scope: None,
        },
    ))
}

// ── Sync (cloud → local) ───────────────────────────────────────────

pub async fn sync_account_tasks(
    cfg: &OauthConfig,
    db: Arc<Mutex<Db>>,
    account_id: &str,
) -> Result<usize> {
    let (provider, tokens) = ensure_access(cfg, &db, account_id).await?;
    let fetched = match provider.as_str() {
        "gmail" => fetch_google_tasks(&tokens.access_token, account_id).await?,
        "outlook" => fetch_graph_tasks(&tokens.access_token, account_id).await?,
        _ => return Err(anyhow!("tasks fetch not impl for {}", provider)),
    };
    let server_ids: std::collections::HashSet<String> =
        fetched.iter().map(|t| t.id.clone()).collect();
    {
        let guard = db.lock();
        // Delete local rows the server didn't return (covers server-side
        // deletions). Only touch THIS account's tasks so other accounts
        // aren't affected.
        let local_ids: Vec<String> = {
            let mut stmt = guard
                .conn()
                .prepare("SELECT id FROM tasks WHERE account_id = ?")?;
            let rows = stmt.query_map(params![account_id], |r| r.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for lid in local_ids {
            if !server_ids.contains(&lid) {
                delete_task_local(&guard, &lid)?;
            }
        }
        for t in &fetched {
            upsert_task_local(&guard, t)?;
        }
    }
    Ok(fetched.len())
}

async fn fetch_google_tasks(access: &str, account_id: &str) -> Result<Vec<Task>> {
    let url = format!(
        "{}/lists/@default/tasks?showCompleted=true&showHidden=true&maxResults=100",
        GOOGLE_TASKS_BASE
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(access)
        .send()
        .await
        .context("google tasks list")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("google tasks list failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let items = v
        .get("items")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    let now_ms = chrono::Utc::now().timestamp_millis();
    for it in items {
        let id = match it.get("id").and_then(|x| x.as_str()) {
            Some(i) => i.to_string(),
            None => continue,
        };
        let title = it
            .get("title")
            .and_then(|x| x.as_str())
            .unwrap_or("(无标题)")
            .to_string();
        let notes = it.get("notes").and_then(|x| x.as_str()).map(String::from);
        let due_ms = it
            .get("due")
            .and_then(|x| x.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.timestamp_millis());
        let completed = it
            .get("status")
            .and_then(|x| x.as_str())
            .map(|s| s == "completed")
            .unwrap_or(false);
        let completed_at_ms = it
            .get("completed")
            .and_then(|x| x.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.timestamp_millis());
        let created_at = it
            .get("updated")
            .and_then(|x| x.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.timestamp_millis())
            .unwrap_or(now_ms);
        out.push(Task {
            id,
            account_id: account_id.to_string(),
            list_id: Some("@default".into()),
            title,
            notes,
            due_ms,
            completed,
            completed_at_ms,
            source_kind: "remote".into(),
            source_brief_item_id: None,
            created_at,
            updated_at: now_ms,
        });
    }
    Ok(out)
}

async fn graph_default_list(access: &str) -> Result<String> {
    let url = format!("{}/me/todo/lists?$top=20", GRAPH_BASE);
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(access)
        .send()
        .await
        .context("graph todo lists")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("graph todo lists failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let arr = v.get("value").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    // Prefer the wellKnownListName="defaultList" if present.
    for it in &arr {
        if it.get("wellKnownListName").and_then(|x| x.as_str()) == Some("defaultList") {
            if let Some(id) = it.get("id").and_then(|x| x.as_str()) {
                return Ok(id.to_string());
            }
        }
    }
    arr.first()
        .and_then(|it| it.get("id").and_then(|x| x.as_str()))
        .map(String::from)
        .ok_or_else(|| anyhow!("graph: no todo lists on account"))
}

async fn fetch_graph_tasks(access: &str, account_id: &str) -> Result<Vec<Task>> {
    let list_id = graph_default_list(access).await?;
    let mut out = Vec::new();
    let mut next: Option<String> = Some(format!(
        "{}/me/todo/lists/{}/tasks?$top=100",
        GRAPH_BASE, list_id
    ));
    let now_ms = chrono::Utc::now().timestamp_millis();
    while let Some(url) = next.take() {
        let resp = reqwest::Client::new()
            .get(&url)
            .bearer_auth(access)
            .send()
            .await
            .context("graph todo tasks")?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("graph todo tasks failed ({}): {}", status, text));
        }
        let v: serde_json::Value = serde_json::from_str(&text)?;
        if let Some(items) = v.get("value").and_then(|x| x.as_array()) {
            for it in items {
                let id = match it.get("id").and_then(|x| x.as_str()) {
                    Some(i) => i.to_string(),
                    None => continue,
                };
                let title = it
                    .get("title")
                    .and_then(|x| x.as_str())
                    .unwrap_or("(无标题)")
                    .to_string();
                let notes = it
                    .get("body")
                    .and_then(|b| b.get("content"))
                    .and_then(|x| x.as_str())
                    .map(String::from);
                let due_ms = it
                    .get("dueDateTime")
                    .and_then(|d| d.get("dateTime"))
                    .and_then(|x| x.as_str())
                    .and_then(|s| {
                        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
                            .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
                            .ok()
                            .map(|dt| dt.and_utc().timestamp_millis())
                    });
                let completed = it
                    .get("status")
                    .and_then(|x| x.as_str())
                    .map(|s| s == "completed")
                    .unwrap_or(false);
                let completed_at_ms = it
                    .get("completedDateTime")
                    .and_then(|d| d.get("dateTime"))
                    .and_then(|x| x.as_str())
                    .and_then(|s| {
                        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
                            .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
                            .ok()
                            .map(|dt| dt.and_utc().timestamp_millis())
                    });
                out.push(Task {
                    id,
                    account_id: account_id.to_string(),
                    list_id: Some(list_id.clone()),
                    title,
                    notes,
                    due_ms,
                    completed,
                    completed_at_ms,
                    source_kind: "remote".into(),
                    source_brief_item_id: None,
                    created_at: now_ms,
                    updated_at: now_ms,
                });
            }
        }
        next = v
            .get("@odata.nextLink")
            .and_then(|x| x.as_str())
            .map(String::from);
    }
    Ok(out)
}

// ── Create ──────────────────────────────────────────────────────────

pub async fn create_task_remote(
    cfg: &OauthConfig,
    db: Arc<Mutex<Db>>,
    input: CreateTaskInput,
) -> Result<Task> {
    let (provider, tokens) = ensure_access(cfg, &db, &input.account_id).await?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut task = match provider.as_str() {
        "gmail" => create_google_task(&tokens.access_token, &input).await?,
        "outlook" => create_graph_task(&tokens.access_token, &input).await?,
        _ => return Err(anyhow!("create-task not impl for {}", provider)),
    };
    task.source_kind = input.source_kind.clone().unwrap_or_else(|| "manual".into());
    task.source_brief_item_id = input.source_brief_item_id.clone();
    task.created_at = now_ms;
    task.updated_at = now_ms;
    {
        let guard = db.lock();
        upsert_task_local(&guard, &task)?;
    }
    Ok(task)
}

async fn create_google_task(access: &str, input: &CreateTaskInput) -> Result<Task> {
    let mut body = serde_json::json!({ "title": input.title });
    if let Some(n) = &input.notes {
        body["notes"] = serde_json::Value::String(n.clone());
    }
    if let Some(d) = input.due_ms {
        // Google Tasks accepts RFC3339; only date part is used.
        let s = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(d)
            .map(|t| t.to_rfc3339())
            .unwrap_or_default();
        body["due"] = serde_json::Value::String(s);
    }
    let url = format!("{}/lists/@default/tasks", GOOGLE_TASKS_BASE);
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(access)
        .json(&body)
        .send()
        .await
        .context("google task create")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("google task create failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let id = v
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("google: no task id in response"))?
        .to_string();
    Ok(Task {
        id,
        account_id: input.account_id.clone(),
        list_id: Some("@default".into()),
        title: input.title.clone(),
        notes: input.notes.clone(),
        due_ms: input.due_ms,
        completed: false,
        completed_at_ms: None,
        source_kind: "manual".into(),
        source_brief_item_id: None,
        created_at: 0,
        updated_at: 0,
    })
}

async fn create_graph_task(access: &str, input: &CreateTaskInput) -> Result<Task> {
    let list_id = graph_default_list(access).await?;
    let mut body = serde_json::json!({ "title": input.title });
    if let Some(n) = &input.notes {
        body["body"] = serde_json::json!({ "content": n, "contentType": "text" });
    }
    if let Some(d) = input.due_ms {
        let s = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(d)
            .map(|t| t.format("%Y-%m-%dT%H:%M:%S").to_string())
            .unwrap_or_default();
        body["dueDateTime"] = serde_json::json!({ "dateTime": s, "timeZone": "UTC" });
    }
    let url = format!("{}/me/todo/lists/{}/tasks", GRAPH_BASE, list_id);
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(access)
        .json(&body)
        .send()
        .await
        .context("graph task create")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("graph task create failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let id = v
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("graph: no task id in response"))?
        .to_string();
    Ok(Task {
        id,
        account_id: input.account_id.clone(),
        list_id: Some(list_id),
        title: input.title.clone(),
        notes: input.notes.clone(),
        due_ms: input.due_ms,
        completed: false,
        completed_at_ms: None,
        source_kind: "manual".into(),
        source_brief_item_id: None,
        created_at: 0,
        updated_at: 0,
    })
}

// ── Update (PATCH completed / title / due) ─────────────────────────

pub async fn update_task_remote(
    cfg: &OauthConfig,
    db: Arc<Mutex<Db>>,
    input: UpdateTaskInput,
) -> Result<Task> {
    // Need the existing row to know which provider + list_id to PATCH.
    let existing = {
        let guard = db.lock();
        guard.conn().query_row(
            "SELECT account_id, list_id, title, notes, due_ms, completed,
                    source_kind, source_brief_item_id, created_at
             FROM tasks WHERE id = ?",
            params![input.id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, i64>(5)? != 0,
                    r.get::<_, String>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, i64>(8)?,
                ))
            },
        )?
    };
    let (account_id, list_id, mut title, mut notes, mut due_ms, mut completed,
         source_kind, source_brief_item_id, created_at) = existing;

    if let Some(t) = input.title.clone() { title = t; }
    if let Some(n) = input.notes.clone() { notes = Some(n); }
    if let Some(d) = input.due_ms { due_ms = Some(d); }
    if let Some(c) = input.completed { completed = c; }

    let (provider, tokens) = ensure_access(cfg, &db, &account_id).await?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    match provider.as_str() {
        "gmail" => {
            patch_google_task(
                &tokens.access_token,
                &input.id,
                &title,
                notes.as_deref(),
                due_ms,
                completed,
            )
            .await?
        }
        "outlook" => {
            let lid = list_id
                .clone()
                .unwrap_or_else(|| String::new());
            patch_graph_task(
                &tokens.access_token,
                &lid,
                &input.id,
                &title,
                notes.as_deref(),
                due_ms,
                completed,
            )
            .await?
        }
        _ => return Err(anyhow!("task update not impl for {}", provider)),
    }
    let completed_at_ms = if completed { Some(now_ms) } else { None };
    let task = Task {
        id: input.id.clone(),
        account_id,
        list_id,
        title,
        notes,
        due_ms,
        completed,
        completed_at_ms,
        source_kind,
        source_brief_item_id,
        created_at,
        updated_at: now_ms,
    };
    {
        let guard = db.lock();
        upsert_task_local(&guard, &task)?;
    }
    Ok(task)
}

async fn patch_google_task(
    access: &str,
    task_id: &str,
    title: &str,
    notes: Option<&str>,
    due_ms: Option<i64>,
    completed: bool,
) -> Result<()> {
    let mut body = serde_json::json!({
        "title": title,
        "status": if completed { "completed" } else { "needsAction" },
    });
    if let Some(n) = notes {
        body["notes"] = serde_json::Value::String(n.to_string());
    }
    if let Some(d) = due_ms {
        let s = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(d)
            .map(|t| t.to_rfc3339())
            .unwrap_or_default();
        body["due"] = serde_json::Value::String(s);
    }
    let url = format!("{}/lists/@default/tasks/{}", GOOGLE_TASKS_BASE, task_id);
    let resp = reqwest::Client::new()
        .patch(&url)
        .bearer_auth(access)
        .json(&body)
        .send()
        .await
        .context("google task patch")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("google task patch failed ({}): {}", status, text));
    }
    Ok(())
}

async fn patch_graph_task(
    access: &str,
    list_id: &str,
    task_id: &str,
    title: &str,
    notes: Option<&str>,
    due_ms: Option<i64>,
    completed: bool,
) -> Result<()> {
    let mut body = serde_json::json!({
        "title": title,
        "status": if completed { "completed" } else { "notStarted" },
    });
    if let Some(n) = notes {
        body["body"] = serde_json::json!({ "content": n, "contentType": "text" });
    }
    if let Some(d) = due_ms {
        let s = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(d)
            .map(|t| t.format("%Y-%m-%dT%H:%M:%S").to_string())
            .unwrap_or_default();
        body["dueDateTime"] = serde_json::json!({ "dateTime": s, "timeZone": "UTC" });
    }
    let url = if list_id.is_empty() {
        // Fallback: look up the default list and retry. Tolerant of older
        // rows that didn't store list_id.
        let list_id = graph_default_list(access).await?;
        format!("{}/me/todo/lists/{}/tasks/{}", GRAPH_BASE, list_id, task_id)
    } else {
        format!("{}/me/todo/lists/{}/tasks/{}", GRAPH_BASE, list_id, task_id)
    };
    let resp = reqwest::Client::new()
        .patch(&url)
        .bearer_auth(access)
        .json(&body)
        .send()
        .await
        .context("graph task patch")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("graph task patch failed ({}): {}", status, text));
    }
    Ok(())
}

// ── Delete ──────────────────────────────────────────────────────────

pub async fn delete_task_remote(
    cfg: &OauthConfig,
    db: Arc<Mutex<Db>>,
    task_id: &str,
) -> Result<()> {
    let (account_id, list_id) = {
        let guard = db.lock();
        guard.conn().query_row(
            "SELECT account_id, list_id FROM tasks WHERE id = ?",
            params![task_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        )?
    };
    let (provider, tokens) = ensure_access(cfg, &db, &account_id).await?;
    match provider.as_str() {
        "gmail" => {
            let url = format!("{}/lists/@default/tasks/{}", GOOGLE_TASKS_BASE, task_id);
            let resp = reqwest::Client::new()
                .delete(&url)
                .bearer_auth(&tokens.access_token)
                .send()
                .await
                .context("google task delete")?;
            let status = resp.status();
            if !status.is_success() && status.as_u16() != 404 {
                let text = resp.text().await.unwrap_or_default();
                return Err(anyhow!("google task delete failed ({}): {}", status, text));
            }
        }
        "outlook" => {
            let lid = match list_id {
                Some(l) if !l.is_empty() => l,
                _ => graph_default_list(&tokens.access_token).await?,
            };
            let url = format!("{}/me/todo/lists/{}/tasks/{}", GRAPH_BASE, lid, task_id);
            let resp = reqwest::Client::new()
                .delete(&url)
                .bearer_auth(&tokens.access_token)
                .send()
                .await
                .context("graph task delete")?;
            let status = resp.status();
            if !status.is_success() && status.as_u16() != 404 {
                let text = resp.text().await.unwrap_or_default();
                return Err(anyhow!("graph task delete failed ({}): {}", status, text));
            }
        }
        _ => return Err(anyhow!("task delete not impl for {}", provider)),
    }
    {
        let guard = db.lock();
        delete_task_local(&guard, task_id)?;
    }
    Ok(())
}
