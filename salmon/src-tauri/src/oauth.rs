//! OAuth 2.0 authorization-code flow with PKCE for Gmail (Google) and
//! eventually Outlook (Microsoft). Desktop-app shape:
//!
//! 1. Frontend asks `start_gmail_oauth()` which generates a state +
//!    code_verifier and starts a one-shot HTTP server on a free
//!    localhost port to catch the redirect.
//! 2. Backend returns the auth URL; frontend opens it via the system
//!    browser (Tauri opener plugin or shell.open).
//! 3. User logs in / consents in browser → Google redirects back to
//!    `http://127.0.0.1:<port>/oauth/callback?code=...&state=...`.
//! 4. The callback handler exchanges the code for refresh_token + access_token,
//!    fetches the user's email via `tokeninfo` / userinfo endpoint, and
//!    persists everything to `mail_accounts`. The pending channel resolves
//!    so the frontend's open `start_gmail_oauth` await returns the new
//!    account record.
//!
//! Refresh tokens are currently stored unencrypted in SQLite — encryption
//! via OS keyring is on the alpha.3 list. The DB file already lives under
//! `~/.local/share/app.salmonapp.desktop/` with user-only perms; this is
//! the same boundary the CLI tools (claude / codex) use for their own
//! credential files.

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
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

const GOOGLE_SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/tasks",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OauthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// epoch-ms when access_token expires.
    pub expires_at_ms: i64,
    pub token_type: String,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GoogleUserInfo {
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

/// In-flight OAuth attempt. Holds the channel that the callback handler
/// resolves once it receives `code` from Google. There's at most one
/// at a time per process (UI flow is modal).
struct PendingOauth {
    code_verifier: String,
    state: String,
    sender: oneshot::Sender<Result<String, String>>,
    redirect_uri: String,
}

#[derive(Clone)]
pub struct OauthBroker {
    pending: Arc<Mutex<Option<PendingOauth>>>,
    /// Cross-provider single-flight gate. Google's flow uses `pending` for
    /// its own state, but `busy` is the shared interlock checked by both
    /// `run_google_oauth` and `run_microsoft_oauth` so they can't run at
    /// the same time (two listener ports + two browser tabs would confuse
    /// the user). Held for the lifetime of an OauthGuard.
    busy: Arc<Mutex<bool>>,
}

impl OauthBroker {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(None)),
            busy: Arc::new(Mutex::new(false)),
        }
    }

    /// Try to claim the cross-provider single-flight slot. Returns a guard
    /// that clears the slot on drop, or None if another flow is in flight.
    pub fn try_acquire(&self) -> Option<OauthGuard> {
        let mut b = self.busy.lock();
        if *b {
            return None;
        }
        *b = true;
        Some(OauthGuard { busy: self.busy.clone() })
    }
}

/// RAII guard for the cross-provider OAuth single-flight slot. Drop
/// clears the busy bit so the next flow can start.
pub struct OauthGuard {
    busy: Arc<Mutex<bool>>,
}

impl Drop for OauthGuard {
    fn drop(&mut self) {
        *self.busy.lock() = false;
    }
}

/// Result of a successful OAuth flow — tokens + user identity.
#[derive(Debug, Clone, Serialize)]
pub struct OauthResult {
    pub tokens: OauthTokens,
    pub userinfo: GoogleUserInfo,
}

pub async fn run_google_oauth(
    cfg: &OauthConfig,
    broker: &OauthBroker,
) -> Result<OauthResult> {
    if !cfg.google_configured() {
        return Err(anyhow!(
            "Google OAuth not configured — drop client_id + client_secret into oauth_config.toml"
        ));
    }

    // Cross-provider single-flight: bail if a Microsoft (or another Google)
    // flow is already in progress. The _guard is held until function return.
    let _guard = broker
        .try_acquire()
        .ok_or_else(|| anyhow!("another OAuth attempt is already in progress"))?;

    // 1. Bind a free port on 127.0.0.1 for the redirect. We do this BEFORE
    //    generating the auth URL so the URL embeds the right port.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("bind oauth callback port")?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{}/oauth/callback", port);

    // 2. PKCE: random verifier + S256 challenge.
    let code_verifier = random_url_safe(64);
    let code_challenge = pkce_challenge(&code_verifier);
    let state = random_url_safe(32);

    // 3. Build the auth URL with all required params.
    let scope = GOOGLE_SCOPES.join(" ");
    let auth_url = format!(
        "{base}?response_type=code&client_id={cid}&redirect_uri={redir}\
         &scope={scope}&state={state}&code_challenge={chal}&code_challenge_method=S256\
         &access_type=offline&prompt=consent",
        base = GOOGLE_AUTH_URL,
        cid = urlencoding::encode(&cfg.google.client_id),
        redir = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(&scope),
        state = urlencoding::encode(&state),
        chal = urlencoding::encode(&code_challenge),
    );

    // 4. Register the pending flow in the broker and spawn the callback
    //    server. Only one OAuth attempt at a time per process.
    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    {
        let mut p = broker.pending.lock();
        if p.is_some() {
            return Err(anyhow!("another OAuth attempt is already in progress"));
        }
        *p = Some(PendingOauth {
            code_verifier: code_verifier.clone(),
            state: state.clone(),
            sender: tx,
            redirect_uri: redirect_uri.clone(),
        });
    }

    let broker_for_server = broker.clone();
    let server_handle = tokio::spawn(async move {
        let router = Router::new()
            .route("/oauth/callback", get(google_callback_handler))
            .with_state(broker_for_server);
        let _ = axum::serve(listener, router).await;
    });

    // 5. Open the system browser to the auth URL. Fire-and-forget — the
    //    user's default browser handles the Google login. If it fails to
    //    launch (no DISPLAY, etc.) we still log the URL so the user can
    //    paste manually.
    eprintln!("[salmon][oauth] open in browser: {}", auth_url);
    open_in_browser(&auth_url);

    // 6. Wait for the callback handler to deliver the code, or timeout.
    let timeout = tokio::time::Duration::from_secs(300);
    let code_result = tokio::time::timeout(timeout, rx).await;
    server_handle.abort();
    let _ = server_handle.await;

    let code = match code_result {
        Ok(Ok(Ok(code))) => code,
        Ok(Ok(Err(msg))) => return Err(anyhow!("oauth callback error: {}", msg)),
        Ok(Err(_)) => return Err(anyhow!("oauth: callback channel closed")),
        Err(_) => return Err(anyhow!("oauth: timed out waiting for browser callback (5min)")),
    };

    // Clear pending slot.
    {
        let mut p = broker.pending.lock();
        *p = None;
    }

    // 7. Exchange the code for tokens.
    let tokens = exchange_code_google(cfg, &code, &code_verifier, &redirect_uri).await?;

    // 8. Pull user identity so we know which email this token belongs to.
    let userinfo = fetch_google_userinfo(&tokens.access_token).await?;

    Ok(OauthResult { tokens, userinfo })
}

/// Companion to run_google_oauth — read the in-flight auth URL so the
/// frontend can open it in the system browser. Returns None if no flow
/// is active. Called by the Tauri command synchronously before it awaits
/// the long-running run_google_oauth future.
pub fn current_auth_url(broker: &OauthBroker) -> Option<String> {
    // We don't actually store the URL — it was passed to the browser by
    // the caller. This helper exists to keep the option open if a future
    // version separates URL generation from the await.
    let _ = broker;
    None
}

async fn google_callback_handler(
    AxumState(broker): AxumState<OauthBroker>,
    Query(params): Query<HashMap<String, String>>,
) -> Html<&'static str> {
    let code = params.get("code").cloned();
    let state = params.get("state").cloned();
    let error = params.get("error").cloned();

    let (sender, expected_state) = {
        let mut p = broker.pending.lock();
        match p.take() {
            Some(pending) => (Some(pending.sender), Some(pending.state)),
            None => (None, None),
        }
    };

    let send_result: Result<String, String> = if let Some(err) = error {
        Err(format!("Google returned error: {}", err))
    } else if state != expected_state {
        Err("state mismatch — possible CSRF or stale callback".to_string())
    } else if let Some(code) = code {
        Ok(code)
    } else {
        Err("no `code` in callback".to_string())
    };

    let ok = send_result.is_ok();
    if let Some(tx) = sender {
        let _ = tx.send(send_result);
    }

    if ok {
        Html(SUCCESS_HTML)
    } else {
        Html(ERROR_HTML)
    }
}

async fn exchange_code_google(
    cfg: &OauthConfig,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<OauthTokens> {
    let client = reqwest::Client::new();
    let params = [
        ("code", code),
        ("client_id", cfg.google.client_id.as_str()),
        ("client_secret", cfg.google.client_secret.as_str()),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", code_verifier),
    ];
    let resp = client
        .post(GOOGLE_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .context("post to google token endpoint")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("token exchange failed ({}): {}", status, text));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).context("parse google token response json")?;
    let access_token = v
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("no access_token in response"))?
        .to_string();
    let refresh_token = v.get("refresh_token").and_then(|x| x.as_str()).map(String::from);
    let expires_in = v.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(3600);
    let token_type = v
        .get("token_type")
        .and_then(|x| x.as_str())
        .unwrap_or("Bearer")
        .to_string();
    let scope = v.get("scope").and_then(|x| x.as_str()).map(String::from);
    let now_ms = chrono::Utc::now().timestamp_millis();
    Ok(OauthTokens {
        access_token,
        refresh_token,
        expires_at_ms: now_ms + expires_in * 1000,
        token_type,
        scope,
    })
}

/// Use a refresh_token to get a new access_token. Called by the Gmail
/// API client when an access_token is within 60s of expiry.
pub async fn refresh_google_access(
    cfg: &OauthConfig,
    refresh_token: &str,
) -> Result<OauthTokens> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", cfg.google.client_id.as_str()),
        ("client_secret", cfg.google.client_secret.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    let resp = client
        .post(GOOGLE_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .context("post google refresh")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("refresh failed ({}): {}", status, text));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).context("parse google refresh response")?;
    let access_token = v
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("no access_token in refresh response"))?
        .to_string();
    let expires_in = v.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(3600);
    // Google sometimes omits the refresh_token in the refresh response
    // (it's still valid; reuse the one we already have).
    let refresh_token = v.get("refresh_token").and_then(|x| x.as_str()).map(String::from);
    let token_type = v
        .get("token_type")
        .and_then(|x| x.as_str())
        .unwrap_or("Bearer")
        .to_string();
    let scope = v.get("scope").and_then(|x| x.as_str()).map(String::from);
    let now_ms = chrono::Utc::now().timestamp_millis();
    Ok(OauthTokens {
        access_token,
        refresh_token,
        expires_at_ms: now_ms + expires_in * 1000,
        token_type,
        scope,
    })
}

async fn fetch_google_userinfo(access_token: &str) -> Result<GoogleUserInfo> {
    let client = reqwest::Client::new();
    let resp = client
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .context("fetch google userinfo")?;
    let v: serde_json::Value = resp.json().await.context("parse userinfo json")?;
    let email = v
        .get("email")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow!("no email in userinfo"))?
        .to_string();
    let name = v.get("name").and_then(|x| x.as_str()).map(String::from);
    let picture = v.get("picture").and_then(|x| x.as_str()).map(String::from);
    Ok(GoogleUserInfo { email, name, picture })
}

fn random_url_safe(byte_len: usize) -> String {
    let mut buf = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(&buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let digest = hasher.finalize();
    URL_SAFE_NO_PAD.encode(digest)
}

pub(crate) fn open_in_browser(url: &str) {
    // Per-OS "open this URL in the user's default browser" command. All
    // are spawned without waiting; if the browser fails to launch the
    // user can still grab the URL from salmon.log.
    #[cfg(target_os = "linux")]
    let cmd = ("xdg-open", url);
    #[cfg(target_os = "macos")]
    let cmd = ("open", url);
    #[cfg(target_os = "windows")]
    let cmd = ("cmd", "/C", "start", url);

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let _ = std::process::Command::new(cmd.0)
            .arg(cmd.1)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}

const SUCCESS_HTML: &str = r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>登录成功</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAFAF9;color:#1B1F23}
.card{text-align:center;padding:32px 40px;border-radius:12px;background:white;box-shadow:0 4px 18px rgba(0,0,0,.08)}
h1{margin:0 0 8px;font-size:20px;color:#16763e}
p{margin:0;color:#6B7280}</style></head>
<body><div class="card"><h1>✓ 已登录</h1><p>可以关闭这个标签页，回到 SalmonApp。</p></div></body></html>"#;

const ERROR_HTML: &str = r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>登录失败</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAFAF9;color:#1B1F23}
.card{text-align:center;padding:32px 40px;border-radius:12px;background:white;box-shadow:0 4px 18px rgba(0,0,0,.08)}
h1{margin:0 0 8px;font-size:20px;color:#B7493D}
p{margin:0;color:#6B7280}</style></head>
<body><div class="card"><h1>× 登录失败</h1><p>SalmonApp 没收到正确的回调，回到 app 重试一次。</p></div></body></html>"#;
