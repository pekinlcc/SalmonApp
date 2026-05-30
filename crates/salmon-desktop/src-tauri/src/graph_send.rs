//! Microsoft Graph mail send. For replies we POST to
//! `/me/messages/{id}/reply` (or `/replyAll`) so Outlook puts the reply
//! into the right conversation; for plain new mail we POST to `/me/sendMail`.
//! Graph builds MIME for us in both shapes.

use crate::gmail_send::OutgoingMessage;
use crate::oauth::OauthTokens;
use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use serde_json::json;

const GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";

/// PATCH `/me/messages/{id}` with isRead. The Graph equivalent of
/// Gmail's `modify(remove: ["UNREAD"])`.
pub async fn mark_read(tokens: &OauthTokens, message_id: &str, read: bool) -> Result<()> {
    let resp = reqwest::Client::new()
        .patch(format!("{}/me/messages/{}", GRAPH_BASE, message_id))
        .bearer_auth(&tokens.access_token)
        .json(&json!({ "isRead": read }))
        .send()
        .await
        .context("graph mark_read")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("graph mark_read failed ({}): {}", status, text));
    }
    Ok(())
}

/// PATCH `/me/messages/{id}` with flag.flagStatus. Graph equivalent of
/// Gmail's STARRED label add/remove.
pub async fn set_flag(tokens: &OauthTokens, message_id: &str, flagged: bool) -> Result<()> {
    let status_str = if flagged { "flagged" } else { "notFlagged" };
    let resp = reqwest::Client::new()
        .patch(format!("{}/me/messages/{}", GRAPH_BASE, message_id))
        .bearer_auth(&tokens.access_token)
        .json(&json!({ "flag": { "flagStatus": status_str } }))
        .send()
        .await
        .context("graph set_flag")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("graph set_flag failed ({}): {}", status, text));
    }
    Ok(())
}

/// POST `/me/messages/{id}/move` with destinationId. Graph equivalent of
/// Gmail's `modify(remove: ["INBOX"])` archive behavior — except Outlook
/// uses well-known folder names (archive / inbox / deletedItems).
pub async fn move_message(tokens: &OauthTokens, message_id: &str, destination: &str) -> Result<()> {
    let resp = reqwest::Client::new()
        .post(format!("{}/me/messages/{}/move", GRAPH_BASE, message_id))
        .bearer_auth(&tokens.access_token)
        .json(&json!({ "destinationId": destination }))
        .send()
        .await
        .context("graph move_message")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("graph move_message failed ({}): {}", status, text));
    }
    Ok(())
}

pub async fn send_message(tokens: &OauthTokens, msg: &OutgoingMessage) -> Result<String> {
    // Build attachments inline (base64). Graph supports up to 4MB
    // inline attachments per call; larger needs upload session, deferred.
    let mut attachments = Vec::new();
    for path in &msg.attachment_paths {
        let p = std::path::Path::new(path);
        let filename = p
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_else(|| "attachment".to_string());
        let bytes = std::fs::read(p)
            .with_context(|| format!("read attachment {}", path))?;
        attachments.push(json!({
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": filename,
            "contentBytes": base64::engine::general_purpose::STANDARD.encode(&bytes),
        }));
    }

    let to_recipients: Vec<_> = msg
        .to
        .iter()
        .map(|e| json!({ "emailAddress": { "address": e } }))
        .collect();
    let cc_recipients: Vec<_> = msg
        .cc
        .iter()
        .map(|e| json!({ "emailAddress": { "address": e } }))
        .collect();
    let bcc_recipients: Vec<_> = msg
        .bcc
        .iter()
        .map(|e| json!({ "emailAddress": { "address": e } }))
        .collect();

    let body = if let Some(html) = &msg.body_html {
        json!({ "contentType": "HTML", "content": html })
    } else {
        json!({ "contentType": "Text", "content": msg.body_text })
    };

    // Reply path: keep the message in the original Outlook conversation.
    // Graph's createReply gives us a draft we can edit before sending —
    // which is the only way to attach files and override recipients (the
    // "comment+message" shape of /reply doesn't expose attachments).
    if let Some(parent_id) = &msg.reply_to_message_id {
        return send_reply_via_graph(
            tokens,
            parent_id,
            &msg.subject,
            &body,
            &to_recipients,
            &cc_recipients,
            &bcc_recipients,
            &attachments,
        )
        .await;
    }

    let envelope = json!({
        "message": {
            "subject": msg.subject,
            "body": body,
            "toRecipients": to_recipients,
            "ccRecipients": cc_recipients,
            "bccRecipients": bcc_recipients,
            "attachments": attachments,
        },
        "saveToSentItems": true,
    });

    let resp = reqwest::Client::new()
        .post(format!("{}/me/sendMail", GRAPH_BASE))
        .bearer_auth(&tokens.access_token)
        .json(&envelope)
        .send()
        .await
        .context("graph send mail")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("graph send failed ({}): {}", status, text));
    }
    // Graph /sendMail returns 202 with no body / no message id. We return
    // a synthetic "sent-<timestamp>" so the FE has something — a future
    // refinement could query the sent folder to find the actual id.
    Ok(format!("sent-{}", chrono::Utc::now().timestamp_millis()))
}

/// Three-step Graph reply that keeps Conversation threading intact:
///   1. POST /me/messages/{id}/createReply   → returns a draft with the
///      parent stitched into the conversation
///   2. PATCH /me/messages/{draft_id}        → set body / subject /
///      recipients / attachments
///   3. POST /me/messages/{draft_id}/send    → fire it
///
/// We can't use /me/messages/{id}/reply directly: that shape only accepts
/// a "comment" string and doesn't expose attachments. createReply + edit
/// + send is the documented way to attach files in a Graph reply.
async fn send_reply_via_graph(
    tokens: &OauthTokens,
    parent_id: &str,
    subject: &str,
    body: &serde_json::Value,
    to: &[serde_json::Value],
    cc: &[serde_json::Value],
    bcc: &[serde_json::Value],
    attachments: &[serde_json::Value],
) -> Result<String> {
    let client = reqwest::Client::new();

    // 1. createReply → draft
    let resp = client
        .post(format!("{}/me/messages/{}/createReply", GRAPH_BASE, parent_id))
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .context("graph createReply")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("graph createReply failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text).context("parse createReply response")?;
    let draft_id = v
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("createReply: no id in response"))?
        .to_string();

    // 2. PATCH the draft to set body + recipients + subject.
    let patch_body = json!({
        "subject": subject,
        "body": body,
        "toRecipients": to,
        "ccRecipients": cc,
        "bccRecipients": bcc,
    });
    let resp = client
        .patch(format!("{}/me/messages/{}", GRAPH_BASE, draft_id))
        .bearer_auth(&tokens.access_token)
        .json(&patch_body)
        .send()
        .await
        .context("graph patch draft")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("graph patch reply failed ({}): {}", status, text));
    }

    // 3. Add attachments (Graph requires one POST per attachment to the
    //    /attachments collection — they can't be set via PATCH).
    for att in attachments {
        let resp = client
            .post(format!("{}/me/messages/{}/attachments", GRAPH_BASE, draft_id))
            .bearer_auth(&tokens.access_token)
            .json(att)
            .send()
            .await
            .context("graph reply attach")?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("graph reply attach failed ({}): {}", status, text));
        }
    }

    // 4. Send.
    let resp = client
        .post(format!("{}/me/messages/{}/send", GRAPH_BASE, draft_id))
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .context("graph send draft")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("graph reply send failed ({}): {}", status, text));
    }
    Ok(draft_id)
}
