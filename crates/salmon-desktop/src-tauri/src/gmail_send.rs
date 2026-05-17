//! Gmail send + draft + reply. Builds RFC-2822 messages, base64url-encodes
//! them, posts to gmail.users.messages.send / .drafts.
//!
//! Attachments: multipart/mixed with base64-encoded parts. We read files
//! from local disk on send (paths come from the FE's file picker).

use crate::oauth::OauthTokens;
use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

const GMAIL_BASE: &str = "https://gmail.googleapis.com/gmail/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutgoingMessage {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_text: String,
    pub body_html: Option<String>,
    /// Local filesystem paths to attach. We read them at send time.
    pub attachment_paths: Vec<String>,
    /// In-Reply-To target. If set, we add the right headers + thread the
    /// message in Gmail's conversation view.
    pub reply_to_message_id: Option<String>,
    /// Gmail thread_id for keeping replies in the same conversation.
    pub thread_id: Option<String>,
    /// References header chain. Caller pre-builds this from the original
    /// message's References + Message-ID.
    pub references: Option<String>,
    /// In-Reply-To header (RFC 2822 Message-ID of the parent).
    pub in_reply_to: Option<String>,
    pub from_email: String,
    pub from_name: Option<String>,
}

/// Send a message via Gmail. Returns the new message's id.
pub async fn send_message(tokens: &OauthTokens, msg: &OutgoingMessage) -> Result<String> {
    let raw = build_raw_message(msg)?;
    let body = serde_json::json!({
        "raw": URL_SAFE_NO_PAD.encode(raw),
        "threadId": msg.thread_id,
    });
    let url = format!("{}/users/me/messages/send", GMAIL_BASE);
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&tokens.access_token)
        .json(&body)
        .send()
        .await
        .context("gmail send")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("gmail send failed ({}): {}", status, text));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).context("parse gmail send response")?;
    Ok(v.get("id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string())
}

/// Save a draft. Returns the draft id (different from the eventual sent
/// message id).
pub async fn save_draft(
    tokens: &OauthTokens,
    msg: &OutgoingMessage,
    existing_draft_id: Option<&str>,
) -> Result<String> {
    let raw = build_raw_message(msg)?;
    let body = serde_json::json!({
        "message": {
            "raw": URL_SAFE_NO_PAD.encode(raw),
            "threadId": msg.thread_id,
        }
    });
    let client = reqwest::Client::new();
    let resp = if let Some(id) = existing_draft_id {
        client
            .put(&format!("{}/users/me/drafts/{}", GMAIL_BASE, id))
            .bearer_auth(&tokens.access_token)
            .json(&body)
            .send()
            .await
    } else {
        client
            .post(&format!("{}/users/me/drafts", GMAIL_BASE))
            .bearer_auth(&tokens.access_token)
            .json(&body)
            .send()
            .await
    }
    .context("gmail draft save")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("gmail draft save failed ({}): {}", status, text));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).context("parse gmail draft response")?;
    Ok(v.get("id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string())
}

/// Mark a single message as read or unread.
pub async fn modify_labels(
    tokens: &OauthTokens,
    message_id: &str,
    add: &[&str],
    remove: &[&str],
) -> Result<()> {
    let body = serde_json::json!({ "addLabelIds": add, "removeLabelIds": remove });
    let resp = reqwest::Client::new()
        .post(format!("{}/users/me/messages/{}/modify", GMAIL_BASE, message_id))
        .bearer_auth(&tokens.access_token)
        .json(&body)
        .send()
        .await
        .context("gmail modify labels")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("modify labels failed ({}): {}", status, text));
    }
    Ok(())
}

fn build_raw_message(msg: &OutgoingMessage) -> Result<Vec<u8>> {
    let from = match &msg.from_name {
        Some(n) if !n.is_empty() => format!("{} <{}>", n, msg.from_email),
        _ => msg.from_email.clone(),
    };
    let boundary = format!("salmon_{}", uuid::Uuid::new_v4().simple());

    let mut out = String::new();
    out.push_str(&format!("From: {}\r\n", from));
    out.push_str(&format!("To: {}\r\n", msg.to.join(", ")));
    if !msg.cc.is_empty() {
        out.push_str(&format!("Cc: {}\r\n", msg.cc.join(", ")));
    }
    // Gmail's messages.send with raw MIME reads the Bcc header to decide
    // who to envelope-deliver to, then strips the header from what every
    // recipient sees — per RFC 5322 and Gmail's documented behavior.
    // (Double-checked: tested Bcc headers do not leak to To/Cc recipients
    // when sent via this API. The audit flagged this as a possible leak;
    // it is not, because Gmail does the stripping for us.)
    if !msg.bcc.is_empty() {
        out.push_str(&format!("Bcc: {}\r\n", msg.bcc.join(", ")));
    }
    // Subject — RFC 2047 encode if non-ASCII.
    let subject = if msg.subject.is_ascii() {
        msg.subject.clone()
    } else {
        format!("=?UTF-8?B?{}?=", base64::engine::general_purpose::STANDARD.encode(&msg.subject))
    };
    out.push_str(&format!("Subject: {}\r\n", subject));
    out.push_str("MIME-Version: 1.0\r\n");
    if let Some(in_reply_to) = &msg.in_reply_to {
        out.push_str(&format!("In-Reply-To: {}\r\n", in_reply_to));
    }
    if let Some(refs) = &msg.references {
        out.push_str(&format!("References: {}\r\n", refs));
    }

    let has_attachments = !msg.attachment_paths.is_empty();
    let has_html = msg.body_html.is_some();

    if has_attachments {
        out.push_str(&format!(
            "Content-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n",
            boundary
        ));
        out.push_str(&format!("--{}\r\n", boundary));
        // First part: body (text or alternative).
        append_body_part(&mut out, msg, has_html)?;
        out.push_str("\r\n");

        // Attachment parts.
        for path in &msg.attachment_paths {
            let p = std::path::Path::new(path);
            let filename = p
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_else(|| "attachment".to_string());
            let bytes =
                std::fs::read(p).with_context(|| format!("read attachment {}", path))?;
            let mime = mime_guess(p);
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            // 76-col wrap per RFC 2045.
            let mut wrapped = String::with_capacity(encoded.len() + encoded.len() / 76);
            for (i, ch) in encoded.chars().enumerate() {
                if i > 0 && i % 76 == 0 {
                    wrapped.push_str("\r\n");
                }
                wrapped.push(ch);
            }
            out.push_str(&format!("--{}\r\n", boundary));
            out.push_str(&format!("Content-Type: {}; name=\"{}\"\r\n", mime, filename));
            out.push_str("Content-Transfer-Encoding: base64\r\n");
            out.push_str(&format!(
                "Content-Disposition: attachment; filename=\"{}\"\r\n\r\n",
                filename
            ));
            out.push_str(&wrapped);
            out.push_str("\r\n");
        }
        out.push_str(&format!("--{}--\r\n", boundary));
    } else if has_html {
        let alt_boundary = format!("salmon_alt_{}", uuid::Uuid::new_v4().simple());
        out.push_str(&format!(
            "Content-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n",
            alt_boundary
        ));
        out.push_str(&format!("--{}\r\n", alt_boundary));
        out.push_str("Content-Type: text/plain; charset=\"UTF-8\"\r\n");
        out.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        out.push_str(&msg.body_text);
        out.push_str("\r\n");
        out.push_str(&format!("--{}\r\n", alt_boundary));
        out.push_str("Content-Type: text/html; charset=\"UTF-8\"\r\n");
        out.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        out.push_str(msg.body_html.as_deref().unwrap_or(""));
        out.push_str("\r\n");
        out.push_str(&format!("--{}--\r\n", alt_boundary));
    } else {
        out.push_str("Content-Type: text/plain; charset=\"UTF-8\"\r\n");
        out.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        out.push_str(&msg.body_text);
    }

    Ok(out.into_bytes())
}

fn append_body_part(
    out: &mut String,
    msg: &OutgoingMessage,
    has_html: bool,
) -> Result<()> {
    if has_html {
        let alt_boundary = format!("salmon_alt_{}", uuid::Uuid::new_v4().simple());
        out.push_str(&format!(
            "Content-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n",
            alt_boundary
        ));
        out.push_str(&format!("--{}\r\n", alt_boundary));
        out.push_str("Content-Type: text/plain; charset=\"UTF-8\"\r\n");
        out.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        out.push_str(&msg.body_text);
        out.push_str("\r\n");
        out.push_str(&format!("--{}\r\n", alt_boundary));
        out.push_str("Content-Type: text/html; charset=\"UTF-8\"\r\n");
        out.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        out.push_str(msg.body_html.as_deref().unwrap_or(""));
        out.push_str("\r\n");
        out.push_str(&format!("--{}--\r\n", alt_boundary));
    } else {
        out.push_str("Content-Type: text/plain; charset=\"UTF-8\"\r\n");
        out.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        out.push_str(&msg.body_text);
    }
    Ok(())
}

fn mime_guess(p: &std::path::Path) -> &'static str {
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}
