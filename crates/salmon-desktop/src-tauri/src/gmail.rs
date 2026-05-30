//! Gmail REST API client. Currently covers the read paths we need for
//! alpha.2 — list message ids by query, fetch full message by id, batch
//! fetch with concurrency. Write paths (send / draft) land in alpha.3.
//!
//! Auth: takes an OauthTokens reference and adds `Authorization: Bearer
//! <access_token>` to every request. If the token is within 60s of expiry,
//! caller should refresh before invoking these.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

const GMAIL_BASE: &str = "https://gmail.googleapis.com/gmail/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailMessageHeader {
    pub id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailMessage {
    pub id: String,
    pub thread_id: String,
    pub label_ids: Vec<String>,
    pub snippet: String,
    pub internal_date_ms: i64,
    pub from_email: Option<String>,
    pub from_name: Option<String>,
    pub to: Vec<EmailAddress>,
    pub cc: Vec<EmailAddress>,
    pub subject: Option<String>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub has_attachments: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAddress {
    pub email: String,
    pub name: Option<String>,
}

/// List recent message ids matching a Gmail search query (default: in:inbox).
/// Returns up to `max_total` ids, paging through Gmail's nextPageToken.
pub async fn list_message_ids(
    access_token: &str,
    query: &str,
    max_total: usize,
) -> Result<Vec<GmailMessageHeader>> {
    let client = reqwest::Client::new();
    let mut out: Vec<GmailMessageHeader> = Vec::new();
    let mut page_token: Option<String> = None;
    while out.len() < max_total {
        let need = (max_total - out.len()).min(500); // gmail max per page
        let mut req = client
            .get(format!("{}/users/me/messages", GMAIL_BASE))
            .bearer_auth(access_token)
            .query(&[("q", query), ("maxResults", &need.to_string())]);
        if let Some(tok) = &page_token {
            req = req.query(&[("pageToken", tok.as_str())]);
        }
        let resp = req.send().await.context("gmail list messages")?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("gmail list failed ({}): {}", status, text));
        }
        let v: serde_json::Value =
            serde_json::from_str(&text).context("parse gmail list json")?;
        if let Some(arr) = v.get("messages").and_then(|x| x.as_array()) {
            for m in arr {
                let id = m.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let thread_id = m
                    .get("threadId")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                if !id.is_empty() {
                    out.push(GmailMessageHeader { id, thread_id });
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

/// Fetch a full message. `format=full` returns headers + body; `metadata`
/// would skip the body. We always grab full because the AI pipeline
/// needs body for analysis.
pub async fn get_message(access_token: &str, id: &str) -> Result<GmailMessage> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/users/me/messages/{}", GMAIL_BASE, id))
        .bearer_auth(access_token)
        .query(&[("format", "full")])
        .send()
        .await
        .context("gmail get message")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("gmail get {} failed ({}): {}", id, status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text).context("parse gmail get json")?;
    parse_gmail_message(&v)
}

/// Convenience: fetch metadata only (headers, no body). Cheap; used for
/// the initial backfill that just populates the inbox list.
pub async fn get_message_metadata(access_token: &str, id: &str) -> Result<GmailMessage> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/users/me/messages/{}", GMAIL_BASE, id))
        .bearer_auth(access_token)
        .query(&[
            ("format", "metadata"),
            ("metadataHeaders", "From"),
            ("metadataHeaders", "To"),
            ("metadataHeaders", "Cc"),
            ("metadataHeaders", "Subject"),
            ("metadataHeaders", "Date"),
        ])
        .send()
        .await
        .context("gmail get metadata")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!(
            "gmail metadata {} failed ({}): {}",
            id,
            status,
            text
        ));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).context("parse gmail metadata json")?;
    parse_gmail_message(&v)
}

fn parse_gmail_message(v: &serde_json::Value) -> Result<GmailMessage> {
    let id = v
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("message has no id"))?
        .to_string();
    let thread_id = v
        .get("threadId")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let label_ids: Vec<String> = v
        .get("labelIds")
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let snippet = v
        .get("snippet")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let internal_date_ms = v
        .get("internalDate")
        .and_then(|x| x.as_str())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let payload = v.get("payload").cloned().unwrap_or(serde_json::json!({}));
    let headers: Vec<(String, String)> = payload
        .get("headers")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|h| {
                    let name = h.get("name").and_then(|x| x.as_str())?.to_string();
                    let value = h.get("value").and_then(|x| x.as_str())?.to_string();
                    Some((name, value))
                })
                .collect()
        })
        .unwrap_or_default();
    let header = |key: &str| -> Option<String> {
        headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.clone())
    };
    let subject = header("Subject");
    let (from_email, from_name) = match header("From") {
        Some(raw) => parse_address(&raw),
        None => (None, None),
    };
    let to = header("To")
        .map(|s| parse_address_list(&s))
        .unwrap_or_default();
    let cc = header("Cc")
        .map(|s| parse_address_list(&s))
        .unwrap_or_default();

    // Walk MIME parts to extract text/html bodies and detect attachments.
    let mut body_text: Option<String> = None;
    let mut body_html: Option<String> = None;
    let mut has_attachments = false;
    walk_parts(&payload, &mut body_text, &mut body_html, &mut has_attachments);

    Ok(GmailMessage {
        id,
        thread_id,
        label_ids,
        snippet,
        internal_date_ms,
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

fn walk_parts(
    part: &serde_json::Value,
    body_text: &mut Option<String>,
    body_html: &mut Option<String>,
    has_attachments: &mut bool,
) {
    let mime_type = part.get("mimeType").and_then(|x| x.as_str()).unwrap_or("");
    let filename = part.get("filename").and_then(|x| x.as_str()).unwrap_or("");
    if !filename.is_empty() {
        *has_attachments = true;
    }
    if mime_type.starts_with("multipart/") {
        if let Some(arr) = part.get("parts").and_then(|x| x.as_array()) {
            for child in arr {
                walk_parts(child, body_text, body_html, has_attachments);
            }
        }
        return;
    }
    let body_data = part
        .get("body")
        .and_then(|b| b.get("data"))
        .and_then(|x| x.as_str());
    if let Some(b64) = body_data {
        if let Ok(bytes) = base64_url_decode(b64) {
            if let Ok(text) = String::from_utf8(bytes) {
                if mime_type == "text/plain" && body_text.is_none() {
                    *body_text = Some(text);
                } else if mime_type == "text/html" && body_html.is_none() {
                    *body_html = Some(text);
                }
            }
        }
    }
}

fn base64_url_decode(s: &str) -> Result<Vec<u8>> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    // Gmail uses URL-safe base64; strip padding if any.
    let trimmed = s.trim_end_matches('=');
    URL_SAFE_NO_PAD
        .decode(trimmed)
        .map_err(|e| anyhow!("base64 decode: {}", e))
}

/// "Alice <alice@example.com>" → (Some("alice@example.com"), Some("Alice"))
/// "alice@example.com" → (Some("alice@example.com"), None)
fn parse_address(raw: &str) -> (Option<String>, Option<String>) {
    let raw = raw.trim();
    if let (Some(lt), Some(gt)) = (raw.find('<'), raw.rfind('>')) {
        if lt < gt {
            let email = raw[lt + 1..gt].trim().to_string();
            let name = raw[..lt].trim().trim_matches('"').trim().to_string();
            let name_opt = if name.is_empty() { None } else { Some(name) };
            return (Some(email), name_opt);
        }
    }
    if raw.contains('@') {
        (Some(raw.to_string()), None)
    } else {
        (None, None)
    }
}

fn parse_address_list(raw: &str) -> Vec<EmailAddress> {
    raw.split(',')
        .filter_map(|s| {
            let (email, name) = parse_address(s);
            email.map(|email| EmailAddress { email, name })
        })
        .collect()
}
