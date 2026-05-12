//! Microsoft OAuth (public client + PKCE) + Graph mail client. Mirrors
//! oauth.rs + gmail.rs shape but uses MS Graph endpoints.
//!
//! No client_secret — Microsoft desktop public clients use PKCE only.
//! Tenant is "common" so both personal and work accounts can sign in.

use crate::oauth::{OauthBroker, OauthResult, OauthTokens, GoogleUserInfo};
use crate::oauth_config::OauthConfig;
use anyhow::{anyhow, Context, Result};
use axum::{
    extract::{Query, State as AxumState},
    response::Html,
    routing::get,
    Router,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const MS_AUTH_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";

const MS_SCOPES: &[&str] = &[
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/Calendars.ReadWrite",
    "https://graph.microsoft.com/Contacts.Read",
    "https://graph.microsoft.com/Tasks.ReadWrite",
    "https://graph.microsoft.com/User.Read",
    "offline_access",
];

struct PendingOauth {
    code_verifier: String,
    state: String,
    sender: oneshot::Sender<Result<String, String>>,
    redirect_uri: String,
}

pub async fn run_microsoft_oauth(
    cfg: &OauthConfig,
    broker: &OauthBroker,
) -> Result<OauthResult> {
    if !cfg.microsoft_configured() {
        return Err(anyhow!("Microsoft OAuth not configured; fill microsoft.client_id in oauth_config.toml"));
    }

    // Cross-provider single-flight: share the gate with Google so a user
    // who double-clicks "+ Outlook" while a Gmail OAuth is mid-flight
    // gets a clean error instead of two competing browser tabs.
    let _guard = broker
        .try_acquire()
        .ok_or_else(|| anyhow!("another OAuth attempt is already in progress"))?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("bind ms oauth callback port")?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{}/oauth/callback", port);

    let code_verifier = random_url_safe(64);
    let code_challenge = pkce_challenge(&code_verifier);
    let state = random_url_safe(32);
    let scope = MS_SCOPES.join(" ");

    let auth_url = format!(
        "{base}?client_id={cid}&response_type=code&redirect_uri={redir}\
         &response_mode=query&scope={scope}&state={state}\
         &code_challenge={chal}&code_challenge_method=S256",
        base = MS_AUTH_URL,
        cid = urlencoding::encode(&cfg.microsoft.client_id),
        redir = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(&scope),
        state = urlencoding::encode(&state),
        chal = urlencoding::encode(&code_challenge),
    );

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let pending = std::sync::Arc::new(parking_lot::Mutex::new(Some(PendingOauth {
        code_verifier: code_verifier.clone(),
        state: state.clone(),
        sender: tx,
        redirect_uri: redirect_uri.clone(),
    })));

    let pending_for_server = pending.clone();
    let server_handle = tokio::spawn(async move {
        let router = Router::new()
            .route(
                "/oauth/callback",
                get(move |state_q: AxumState<std::sync::Arc<parking_lot::Mutex<Option<PendingOauth>>>>, query: Query<HashMap<String, String>>| async move {
                    ms_callback_handler(state_q, query).await
                }),
            )
            .with_state(pending_for_server);
        let _ = axum::serve(listener, router).await;
    });

    eprintln!("[salmon][ms-oauth] open in browser: {}", auth_url);
    crate::oauth::open_in_browser(&auth_url);

    let timeout = tokio::time::Duration::from_secs(300);
    let code_result = tokio::time::timeout(timeout, rx).await;
    server_handle.abort();
    let _ = server_handle.await;

    let code = match code_result {
        Ok(Ok(Ok(code))) => code,
        Ok(Ok(Err(msg))) => return Err(anyhow!("ms oauth callback error: {}", msg)),
        Ok(Err(_)) => return Err(anyhow!("ms oauth callback channel closed")),
        Err(_) => return Err(anyhow!("ms oauth timed out (5min)")),
    };

    let tokens = exchange_code_ms(cfg, &code, &code_verifier, &redirect_uri).await?;
    let userinfo = fetch_ms_userinfo(&tokens.access_token).await?;

    Ok(OauthResult { tokens, userinfo })
}

async fn ms_callback_handler(
    AxumState(pending): AxumState<std::sync::Arc<parking_lot::Mutex<Option<PendingOauth>>>>,
    Query(params): Query<HashMap<String, String>>,
) -> Html<&'static str> {
    let code = params.get("code").cloned();
    let state = params.get("state").cloned();
    let error = params.get("error").cloned();

    let (sender, expected_state) = {
        let mut p = pending.lock();
        match p.take() {
            Some(pending) => (Some(pending.sender), Some(pending.state)),
            None => (None, None),
        }
    };

    let send_result: Result<String, String> = if let Some(err) = error {
        Err(format!("Microsoft returned error: {}", err))
    } else if state != expected_state {
        Err("state mismatch".to_string())
    } else if let Some(code) = code {
        Ok(code)
    } else {
        Err("no code".to_string())
    };

    if let Some(tx) = sender {
        let ok = send_result.is_ok();
        let _ = tx.send(send_result);
        if ok {
            Html(SUCCESS_HTML)
        } else {
            Html(ERROR_HTML)
        }
    } else {
        Html(ERROR_HTML)
    }
}

async fn exchange_code_ms(
    cfg: &OauthConfig,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<OauthTokens> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", cfg.microsoft.client_id.as_str()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", code_verifier),
    ];
    let resp = client
        .post(MS_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .context("ms token exchange")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("ms token exchange failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let access_token = v
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("no access_token"))?
        .to_string();
    let refresh_token = v.get("refresh_token").and_then(|x| x.as_str()).map(String::from);
    let expires_in = v.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(3600);
    let token_type = v
        .get("token_type")
        .and_then(|x| x.as_str())
        .unwrap_or("Bearer")
        .to_string();
    let scope = v.get("scope").and_then(|x| x.as_str()).map(String::from);
    Ok(OauthTokens {
        access_token,
        refresh_token,
        expires_at_ms: chrono::Utc::now().timestamp_millis() + expires_in * 1000,
        token_type,
        scope,
    })
}

pub async fn refresh_microsoft_access(
    cfg: &OauthConfig,
    refresh_token: &str,
) -> Result<OauthTokens> {
    let client = reqwest::Client::new();
    let scope = MS_SCOPES.join(" ");
    let params = [
        ("client_id", cfg.microsoft.client_id.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
        ("scope", scope.as_str()),
    ];
    let resp = client
        .post(MS_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .context("ms refresh")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("ms refresh failed ({}): {}", status, text));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let access_token = v
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("no access_token in refresh"))?
        .to_string();
    let refresh_token = v.get("refresh_token").and_then(|x| x.as_str()).map(String::from);
    let expires_in = v.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(3600);
    Ok(OauthTokens {
        access_token,
        refresh_token,
        expires_at_ms: chrono::Utc::now().timestamp_millis() + expires_in * 1000,
        token_type: "Bearer".to_string(),
        scope: v.get("scope").and_then(|x| x.as_str()).map(String::from),
    })
}

async fn fetch_ms_userinfo(access_token: &str) -> Result<GoogleUserInfo> {
    let resp = reqwest::Client::new()
        .get(format!("{}/me", MS_GRAPH_BASE))
        .bearer_auth(access_token)
        .send()
        .await
        .context("ms userinfo")?;
    let v: serde_json::Value = resp.json().await?;
    let email = v
        .get("mail")
        .or(v.get("userPrincipalName"))
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("no email in ms userinfo"))?
        .to_string();
    let name = v.get("displayName").and_then(|x| x.as_str()).map(String::from);
    Ok(GoogleUserInfo {
        email,
        name,
        picture: None,
    })
}

fn random_url_safe(byte_len: usize) -> String {
    let mut buf = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(&buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

const SUCCESS_HTML: &str = r#"<!doctype html>
<html><head><meta charset="UTF-8"><title>登录成功</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAFAF9}
.card{text-align:center;padding:32px 40px;border-radius:12px;background:white;box-shadow:0 4px 18px rgba(0,0,0,.08)}
h1{margin:0 0 8px;font-size:20px;color:#16763e}</style></head>
<body><div class="card"><h1>✓ Outlook 已登录</h1><p>可以关闭这个标签页。</p></div></body></html>"#;

const ERROR_HTML: &str = r#"<!doctype html>
<html><head><meta charset="UTF-8"><title>登录失败</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAFAF9}
.card{text-align:center;padding:32px 40px;border-radius:12px;background:white}h1{color:#B7493D}</style></head>
<body><div class="card"><h1>× 登录失败</h1></div></body></html>"#;
