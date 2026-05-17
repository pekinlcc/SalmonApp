//! Microsoft Graph mail read API (mirrors gmail.rs shape). Endpoints
//! under /me/messages. Outlook conversations correspond to Gmail threads.

use crate::gmail::{EmailAddress, GmailMessage};
use anyhow::{anyhow, Context, Result};

const GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";

pub async fn list_inbox_ids(access_token: &str, max: usize) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut next_link: Option<String> = Some(format!(
        "{}/me/mailFolders/inbox/messages?$select=id&$top=50&$orderby=receivedDateTime desc",
        GRAPH_BASE
    ));
    while let Some(url) = next_link.take() {
        if out.len() >= max {
            break;
        }
        let resp = reqwest::Client::new()
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await
            .context("graph list messages")?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("graph list failed ({}): {}", status, text));
        }
        let v: serde_json::Value = serde_json::from_str(&text)?;
        if let Some(arr) = v.get("value").and_then(|x| x.as_array()) {
            for m in arr {
                if let Some(id) = m.get("id").and_then(|x| x.as_str()) {
                    out.push(id.to_string());
                    if out.len() >= max {
                        break;
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

pub async fn get_message(access_token: &str, id: &str) -> Result<GmailMessage> {
    let resp = reqwest::Client::new()
        .get(format!(
            "{}/me/messages/{}?$select=id,conversationId,from,toRecipients,ccRecipients,subject,bodyPreview,body,receivedDateTime,isRead,hasAttachments,categories,flag",
            GRAPH_BASE, id
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .context("graph get message")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("graph get {} failed ({}): {}", id, status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    parse_graph_message(&v)
}

fn parse_graph_message(v: &serde_json::Value) -> Result<GmailMessage> {
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let thread_id = v
        .get("conversationId")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let received = v
        .get("receivedDateTime")
        .and_then(|x| x.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or(0);
    let snippet = v
        .get("bodyPreview")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let subject = v.get("subject").and_then(|x| x.as_str()).map(String::from);
    let is_read = v.get("isRead").and_then(|x| x.as_bool()).unwrap_or(true);

    let (from_email, from_name) = parse_graph_email(v.get("from"));
    let to = parse_graph_email_list(v.get("toRecipients"));
    let cc = parse_graph_email_list(v.get("ccRecipients"));

    let body_obj = v.get("body");
    let body_kind = body_obj.and_then(|b| b.get("contentType")).and_then(|x| x.as_str()).unwrap_or("text");
    let body_raw = body_obj
        .and_then(|b| b.get("content"))
        .and_then(|x| x.as_str())
        .map(String::from);
    let (body_text, body_html) = if body_kind.eq_ignore_ascii_case("html") {
        (None, body_raw)
    } else {
        (body_raw, None)
    };

    let has_attachments = v.get("hasAttachments").and_then(|x| x.as_bool()).unwrap_or(false);

    let label_ids: Vec<String> = if is_read { vec![] } else { vec!["UNREAD".into()] };

    Ok(GmailMessage {
        id,
        thread_id,
        label_ids,
        snippet,
        internal_date_ms: received,
        from_email,
        from_name,
        to,
        cc,
        subject,
        body_text,
        body_html,
        has_attachments,
    })
}

fn parse_graph_email(v: Option<&serde_json::Value>) -> (Option<String>, Option<String>) {
    let Some(v) = v else { return (None, None) };
    let addr = v.get("emailAddress");
    let email = addr.and_then(|a| a.get("address")).and_then(|x| x.as_str()).map(String::from);
    let name = addr.and_then(|a| a.get("name")).and_then(|x| x.as_str()).map(String::from);
    (email, name)
}

fn parse_graph_email_list(v: Option<&serde_json::Value>) -> Vec<EmailAddress> {
    let Some(arr) = v.and_then(|x| x.as_array()) else { return Vec::new() };
    arr.iter()
        .filter_map(|item| {
            let (email, name) = parse_graph_email(Some(item));
            email.map(|email| EmailAddress { email, name })
        })
        .collect()
}
