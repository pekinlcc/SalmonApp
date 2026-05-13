//! Calendar API clients (Google Calendar + Microsoft Graph) + sync to
//! local `calendar_events` table.
//!
//! Sync window: 7 days back, 90 days forward. CRUD via dedicated commands.

use crate::db::Db;
use crate::microsoft::refresh_microsoft_access;
use crate::oauth::{refresh_google_access, OauthTokens};
use crate::oauth_config::OauthConfig;
use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const GOOGLE_CAL_BASE: &str = "https://www.googleapis.com/calendar/v3";
const GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    pub id: String,
    pub account_id: String,
    pub calendar_id: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    pub title: Option<String>,
    pub location: Option<String>,
    pub description: Option<String>,
    pub attendees: Vec<Attendee>,
    pub organizer: Option<String>,
    pub recurrence: Option<String>,
    pub status: Option<String>,
    pub my_response: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attendee {
    pub email: String,
    pub name: Option<String>,
    pub response: Option<String>,
}

pub async fn sync_account_calendar(
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
        if let Some(rt) = tokens.refresh_token.clone() {
            let new = match provider.as_str() {
                "gmail" => refresh_google_access(cfg, &rt).await?,
                "outlook" => refresh_microsoft_access(cfg, &rt).await?,
                _ => return Err(anyhow!("calendar sync not impl for {}", provider)),
            };
            tokens.access_token = new.access_token;
            tokens.expires_at_ms = new.expires_at_ms;
            if let Some(r) = new.refresh_token {
                tokens.refresh_token = Some(r);
            }
            let guard = db.lock();
            crate::mail_sync::persist_tokens(&guard, account_id, &tokens)?;
        } else {
            return Err(anyhow!("no refresh_token for calendar sync"));
        }
    }

    let events: Vec<CalEvent> = match provider.as_str() {
        "gmail" => fetch_google_events(&tokens.access_token, account_id).await?,
        "outlook" => fetch_graph_events(&tokens.access_token, account_id).await?,
        _ => return Err(anyhow!("calendar fetch not impl for {}", provider)),
    };

    let n = events.len();
    let server_ids: std::collections::HashSet<String> =
        events.iter().map(|e| e.id.clone()).collect();
    {
        let guard = db.lock();
        // Reflect server-side deletions by removing local rows in the window
        // that the server *didn't* return. Naive "delete window then re-insert"
        // would lose data on any partial fetch (transient API error, missing
        // pagination, etc). Build the set of server-returned ids first, then
        // delete the complement.
        let week_ago = now_ms - 7 * 86400_000;
        let three_months = now_ms + 90 * 86400_000;
        let local_ids: Vec<String> = {
            let mut stmt = guard.conn().prepare(
                "SELECT id FROM calendar_events
                 WHERE account_id = ? AND start_ms >= ? AND start_ms <= ?",
            )?;
            let rows = stmt.query_map(
                params![account_id, week_ago, three_months],
                |r| r.get::<_, String>(0),
            )?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for lid in local_ids {
            if !server_ids.contains(&lid) {
                guard.conn().execute(
                    "DELETE FROM calendar_events WHERE id = ?",
                    params![lid],
                )?;
            }
        }
        for e in &events {
            upsert_event(&guard, e)?;
        }
    }
    Ok(n)
}

async fn fetch_google_events(access: &str, account_id: &str) -> Result<Vec<CalEvent>> {
    let now = chrono::Utc::now();
    let time_min = (now - chrono::Duration::days(7)).to_rfc3339();
    let time_max = (now + chrono::Duration::days(90)).to_rfc3339();
    let client = reqwest::Client::new();
    let mut out = Vec::new();
    let mut page_token: Option<String> = None;
    // Bound the page-loop so a runaway nextPageToken can never spin forever.
    for _ in 0..20 {
        let mut url = format!(
            "{}/calendars/primary/events?timeMin={}&timeMax={}&maxResults=250&singleEvents=true&orderBy=startTime",
            GOOGLE_CAL_BASE,
            urlencoding::encode(&time_min),
            urlencoding::encode(&time_max),
        );
        if let Some(tok) = &page_token {
            url.push_str("&pageToken=");
            url.push_str(&urlencoding::encode(tok));
        }
        let resp = client
            .get(&url)
            .bearer_auth(access)
            .send()
            .await
            .context("google cal list")?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("google cal list failed ({}): {}", status, text));
        }
        let v: serde_json::Value = serde_json::from_str(&text)?;
        if let Some(items) = v.get("items").and_then(|x| x.as_array()) {
            for it in items {
                if let Some(ev) = parse_google_event(it, account_id) {
                    out.push(ev);
                }
            }
        }
        page_token = v.get("nextPageToken").and_then(|x| x.as_str()).map(String::from);
        if page_token.is_none() {
            break;
        }
    }
    Ok(out)
}

fn parse_google_event(v: &serde_json::Value, account_id: &str) -> Option<CalEvent> {
    let id = v.get("id").and_then(|x| x.as_str())?.to_string();
    let title = v.get("summary").and_then(|x| x.as_str()).map(String::from);
    let location = v.get("location").and_then(|x| x.as_str()).map(String::from);
    let description = v.get("description").and_then(|x| x.as_str()).map(String::from);

    let start = v.get("start")?;
    let end = v.get("end")?;
    let all_day = start.get("date").is_some();
    let parse_dt = |obj: &serde_json::Value| -> Option<i64> {
        if let Some(s) = obj.get("dateTime").and_then(|x| x.as_str()) {
            chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis())
        } else if let Some(s) = obj.get("date").and_then(|x| x.as_str()) {
            // YYYY-MM-DD — treat as local midnight UTC for sortability.
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(0, 0, 0))
                .map(|dt| dt.and_utc().timestamp_millis())
        } else {
            None
        }
    };
    let start_ms = parse_dt(start)?;
    let end_ms = parse_dt(end).unwrap_or(start_ms);

    let attendees: Vec<Attendee> = v
        .get("attendees")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let email = a.get("email").and_then(|x| x.as_str())?.to_string();
                    Some(Attendee {
                        email,
                        name: a.get("displayName").and_then(|x| x.as_str()).map(String::from),
                        response: a.get("responseStatus").and_then(|x| x.as_str()).map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let organizer = v
        .get("organizer")
        .and_then(|o| o.get("email"))
        .and_then(|x| x.as_str())
        .map(String::from);

    let status = v.get("status").and_then(|x| x.as_str()).map(String::from);

    Some(CalEvent {
        id,
        account_id: account_id.to_string(),
        calendar_id: Some("primary".to_string()),
        start_ms,
        end_ms,
        all_day,
        title,
        location,
        description,
        attendees,
        organizer,
        recurrence: None,
        status,
        my_response: None,
    })
}

async fn fetch_graph_events(access: &str, account_id: &str) -> Result<Vec<CalEvent>> {
    let now = chrono::Utc::now();
    let start_dt = (now - chrono::Duration::days(7)).to_rfc3339();
    let end_dt = (now + chrono::Duration::days(90)).to_rfc3339();
    let client = reqwest::Client::new();
    let mut out = Vec::new();
    let mut next_link: Option<String> = Some(format!(
        "{}/me/calendarView?startDateTime={}&endDateTime={}&$top=100&$orderby=start/dateTime",
        GRAPH_BASE,
        urlencoding::encode(&start_dt),
        urlencoding::encode(&end_dt),
    ));
    for _ in 0..20 {
        let Some(url) = next_link.take() else { break };
        let resp = client
            .get(&url)
            .bearer_auth(access)
            .header("Prefer", "outlook.timezone=\"UTC\"")
            .send()
            .await
            .context("graph cal list")?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("graph cal list failed ({}): {}", status, text));
        }
        let v: serde_json::Value = serde_json::from_str(&text)?;
        if let Some(items) = v.get("value").and_then(|x| x.as_array()) {
            for it in items {
                if let Some(ev) = parse_graph_event(it, account_id) {
                    out.push(ev);
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

fn parse_graph_event(v: &serde_json::Value, account_id: &str) -> Option<CalEvent> {
    let id = v.get("id").and_then(|x| x.as_str())?.to_string();
    let title = v.get("subject").and_then(|x| x.as_str()).map(String::from);
    let location = v
        .get("location")
        .and_then(|l| l.get("displayName"))
        .and_then(|x| x.as_str())
        .map(String::from);
    let description = v
        .get("bodyPreview")
        .and_then(|x| x.as_str())
        .map(String::from);

    let parse_graph_dt = |obj: &serde_json::Value| -> Option<i64> {
        let s = obj.get("dateTime").and_then(|x| x.as_str())?;
        // Graph returns naive datetime + separate timeZone; with "Prefer:
        // outlook.timezone=UTC" the times are UTC.
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
            .ok()
            .map(|dt| dt.and_utc().timestamp_millis())
    };
    let start_ms = parse_graph_dt(v.get("start")?)?;
    let end_ms = parse_graph_dt(v.get("end")?).unwrap_or(start_ms);
    let all_day = v.get("isAllDay").and_then(|x| x.as_bool()).unwrap_or(false);

    let attendees: Vec<Attendee> = v
        .get("attendees")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let ea = a.get("emailAddress")?;
                    let email = ea.get("address").and_then(|x| x.as_str())?.to_string();
                    Some(Attendee {
                        email,
                        name: ea.get("name").and_then(|x| x.as_str()).map(String::from),
                        response: a
                            .get("status")
                            .and_then(|s| s.get("response"))
                            .and_then(|x| x.as_str())
                            .map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let organizer = v
        .get("organizer")
        .and_then(|o| o.get("emailAddress"))
        .and_then(|e| e.get("address"))
        .and_then(|x| x.as_str())
        .map(String::from);

    Some(CalEvent {
        id,
        account_id: account_id.to_string(),
        calendar_id: None,
        start_ms,
        end_ms,
        all_day,
        title,
        location,
        description,
        attendees,
        organizer,
        recurrence: None,
        status: None,
        my_response: None,
    })
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

fn upsert_event(db: &Db, e: &CalEvent) -> Result<()> {
    let attendees_json = serde_json::to_string(&e.attendees)?;
    db.conn().execute(
        "INSERT INTO calendar_events
           (id, account_id, calendar_id, start_ms, end_ms, all_day,
            title, location, description, attendees, organizer,
            recurrence, status, my_response)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           start_ms=excluded.start_ms,
           end_ms=excluded.end_ms,
           all_day=excluded.all_day,
           title=excluded.title,
           location=excluded.location,
           description=excluded.description,
           attendees=excluded.attendees,
           organizer=excluded.organizer,
           status=excluded.status",
        params![
            e.id,
            e.account_id,
            e.calendar_id,
            e.start_ms,
            e.end_ms,
            if e.all_day { 1 } else { 0 },
            e.title,
            e.location,
            e.description,
            attendees_json,
            e.organizer,
            e.recurrence,
            e.status,
            e.my_response,
        ],
    )?;
    Ok(())
}

/// User-initiated event creation (briefing pipeline → "create calendar"
/// button). Writes through to Google Calendar or Microsoft Graph based on
/// the chosen account's provider, then upserts the returned event into
/// `calendar_events` so the local CalendarView shows it on next refresh.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventInput {
    pub account_id: String,
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    pub location: Option<String>,
}

pub async fn create_event_remote(
    cfg: &OauthConfig,
    db: Arc<Mutex<Db>>,
    input: CreateEventInput,
) -> Result<CalEvent> {
    let (provider, mut tokens) = {
        let guard = db.lock();
        load_account(&guard, &input.account_id)?
    };
    let now_ms = chrono::Utc::now().timestamp_millis();
    if tokens.expires_at_ms - now_ms < 60_000 {
        let rt = tokens
            .refresh_token
            .clone()
            .ok_or_else(|| anyhow!("no refresh_token for create-event"))?;
        let new = match provider.as_str() {
            "gmail" => refresh_google_access(cfg, &rt).await?,
            "outlook" => refresh_microsoft_access(cfg, &rt).await?,
            _ => return Err(anyhow!("create-event not impl for {}", provider)),
        };
        tokens.access_token = new.access_token;
        tokens.expires_at_ms = new.expires_at_ms;
        if let Some(r) = new.refresh_token {
            tokens.refresh_token = Some(r);
        }
        let guard = db.lock();
        crate::mail_sync::persist_tokens(&guard, &input.account_id, &tokens)?;
    }

    let event = match provider.as_str() {
        "gmail" => create_google_event(&tokens.access_token, &input).await?,
        "outlook" => create_graph_event(&tokens.access_token, &input).await?,
        other => return Err(anyhow!("create-event not impl for {}", other)),
    };

    // Reflect in local DB immediately so CalendarView doesn't have to wait
    // for the next sync_calendar.
    let row = CalEvent {
        id: event.id.clone(),
        account_id: input.account_id.clone(),
        calendar_id: Some("primary".to_string()),
        start_ms: input.start_ms,
        end_ms: input.end_ms,
        all_day: input.all_day,
        title: Some(input.title.clone()),
        location: input.location.clone(),
        description: None,
        attendees: Vec::new(),
        organizer: None,
        recurrence: None,
        status: Some("confirmed".to_string()),
        my_response: Some("accepted".to_string()),
    };
    {
        let guard = db.lock();
        upsert_event(&guard, &row)?;
    }
    Ok(row)
}

#[derive(Debug)]
struct CreatedRemoteEvent {
    id: String,
}

async fn create_google_event(
    access: &str,
    input: &CreateEventInput,
) -> Result<CreatedRemoteEvent> {
    let body = if input.all_day {
        // YYYY-MM-DD per RFC 3339 date-only. Google requires end.date to
        // be EXCLUSIVE (one day AFTER the last day of the event). User
        // who picks "May 12 all-day" sends start=end=local midnight 5/12;
        // we bump end_date to 5/13 so Google actually shows the event.
        let start_d = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.start_ms)
            .map(|t| t.with_timezone(&chrono::Local).date_naive())
            .ok_or_else(|| anyhow!("bad start_ms for all-day event"))?;
        let mut end_d = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.end_ms)
            .map(|t| t.with_timezone(&chrono::Local).date_naive())
            .unwrap_or(start_d);
        if end_d <= start_d {
            end_d = start_d.succ_opt().unwrap_or(start_d);
        }
        serde_json::json!({
            "summary": input.title,
            "location": input.location,
            "start": { "date": start_d.format("%Y-%m-%d").to_string() },
            "end":   { "date": end_d.format("%Y-%m-%d").to_string() },
        })
    } else {
        // Send dateTime with explicit "Z" + timeZone:UTC so Google never has
        // to guess the offset. Without this the event sometimes lands at
        // the wrong displayed hour for users who couldn't find it in their
        // calendar UI.
        let start = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.start_ms)
            .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .unwrap_or_default();
        let end = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.end_ms)
            .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            .unwrap_or(start.clone());
        serde_json::json!({
            "summary": input.title,
            "location": input.location,
            "start": { "dateTime": start, "timeZone": "UTC" },
            "end":   { "dateTime": end,   "timeZone": "UTC" },
        })
    };
    eprintln!(
        "[salmon][cal] create_google_event payload: {}",
        serde_json::to_string(&body).unwrap_or_default()
    );
    let url = format!("{}/calendars/primary/events", GOOGLE_CAL_BASE);
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(access)
        .json(&body)
        .send()
        .await
        .context("google cal create")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("google cal create failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let id = v
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("google: no id in create response"))?
        .to_string();
    Ok(CreatedRemoteEvent { id })
}

async fn create_graph_event(
    access: &str,
    input: &CreateEventInput,
) -> Result<CreatedRemoteEvent> {
    let body = if input.all_day {
        // Graph requires end-of-day-AFTER for all-day events too. Send
        // both dateTimes at midnight UTC; the dates stay aligned with
        // what the user picked locally.
        let start_d = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.start_ms)
            .map(|t| t.with_timezone(&chrono::Local).date_naive())
            .ok_or_else(|| anyhow!("bad start_ms for all-day event"))?;
        let mut end_d = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.end_ms)
            .map(|t| t.with_timezone(&chrono::Local).date_naive())
            .unwrap_or(start_d);
        if end_d <= start_d {
            end_d = start_d.succ_opt().unwrap_or(start_d);
        }
        let start_dt = format!("{}T00:00:00", start_d.format("%Y-%m-%d"));
        let end_dt = format!("{}T00:00:00", end_d.format("%Y-%m-%d"));
        serde_json::json!({
            "subject": input.title,
            "isAllDay": true,
            "location": { "displayName": input.location.clone().unwrap_or_default() },
            "start": { "dateTime": start_dt, "timeZone": "UTC" },
            "end":   { "dateTime": end_dt, "timeZone": "UTC" },
        })
    } else {
        let start = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.start_ms)
            .map(|t| t.format("%Y-%m-%dT%H:%M:%S").to_string())
            .unwrap_or_default();
        let end = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.end_ms)
            .map(|t| t.format("%Y-%m-%dT%H:%M:%S").to_string())
            .unwrap_or(start.clone());
        serde_json::json!({
            "subject": input.title,
            "location": { "displayName": input.location.clone().unwrap_or_default() },
            "start": { "dateTime": start, "timeZone": "UTC" },
            "end":   { "dateTime": end,   "timeZone": "UTC" },
        })
    };
    let url = format!("{}/me/events", GRAPH_BASE);
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(access)
        .json(&body)
        .send()
        .await
        .context("graph event create")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("graph event create failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let id = v
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("graph: no id in create response"))?
        .to_string();
    Ok(CreatedRemoteEvent { id })
}

pub async fn delete_event_remote(
    cfg: &OauthConfig,
    db: Arc<Mutex<Db>>,
    account_id: &str,
    event_id: &str,
) -> Result<()> {
    let (provider, mut tokens) = {
        let guard = db.lock();
        load_account(&guard, account_id)?
    };
    let now_ms = chrono::Utc::now().timestamp_millis();
    if tokens.expires_at_ms - now_ms < 60_000 {
        let rt = tokens
            .refresh_token
            .clone()
            .ok_or_else(|| anyhow!("no refresh_token for delete-event"))?;
        let new = match provider.as_str() {
            "gmail" => refresh_google_access(cfg, &rt).await?,
            "outlook" => refresh_microsoft_access(cfg, &rt).await?,
            _ => return Err(anyhow!("delete-event not impl for {}", provider)),
        };
        tokens.access_token = new.access_token;
        tokens.expires_at_ms = new.expires_at_ms;
        if let Some(r) = new.refresh_token { tokens.refresh_token = Some(r); }
        let guard = db.lock();
        crate::mail_sync::persist_tokens(&guard, account_id, &tokens)?;
    }
    match provider.as_str() {
        "gmail" => {
            let url = format!("{}/calendars/primary/events/{}", GOOGLE_CAL_BASE, event_id);
            let resp = reqwest::Client::new()
                .delete(&url)
                .bearer_auth(&tokens.access_token)
                .send()
                .await
                .context("google cal delete")?;
            let status = resp.status();
            if !status.is_success() && status.as_u16() != 404 && status.as_u16() != 410 {
                let text = resp.text().await.unwrap_or_default();
                return Err(anyhow!("google cal delete failed ({}): {}", status, text));
            }
        }
        "outlook" => {
            let url = format!("{}/me/events/{}", GRAPH_BASE, event_id);
            let resp = reqwest::Client::new()
                .delete(&url)
                .bearer_auth(&tokens.access_token)
                .send()
                .await
                .context("graph event delete")?;
            let status = resp.status();
            if !status.is_success() && status.as_u16() != 404 {
                let text = resp.text().await.unwrap_or_default();
                return Err(anyhow!("graph event delete failed ({}): {}", status, text));
            }
        }
        other => return Err(anyhow!("delete-event not impl for {}", other)),
    }
    {
        let guard = db.lock();
        guard.conn().execute(
            "DELETE FROM calendar_events WHERE id = ?",
            params![event_id],
        )?;
    }
    Ok(())
}

pub fn list_events_window(
    db: &Db,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<CalEvent>> {
    let mut stmt = db.conn().prepare(
        "SELECT id, account_id, calendar_id, start_ms, end_ms, all_day,
                title, location, description, attendees, organizer,
                recurrence, status, my_response
         FROM calendar_events
         WHERE start_ms >= ? AND start_ms <= ?
         ORDER BY start_ms ASC",
    )?;
    let rows = stmt.query_map(params![start_ms, end_ms], |r| {
        let attendees_json: Option<String> = r.get(9)?;
        let attendees: Vec<Attendee> = attendees_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Ok(CalEvent {
            id: r.get(0)?,
            account_id: r.get(1)?,
            calendar_id: r.get(2)?,
            start_ms: r.get(3)?,
            end_ms: r.get(4)?,
            all_day: r.get::<_, i64>(5)? != 0,
            title: r.get(6)?,
            location: r.get(7)?,
            description: r.get(8)?,
            attendees,
            organizer: r.get(10)?,
            recurrence: r.get(11)?,
            status: r.get(12)?,
            my_response: r.get(13)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}
