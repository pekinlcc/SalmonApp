//! Load OAuth credentials from `oauth_config.toml`. Resolution order:
//!
//! 1. `$SALMON_OAUTH_CONFIG` env var if set (absolute path)
//! 2. `$XDG_CONFIG_HOME/salmonapp/oauth_config.toml` (or `~/.config/salmonapp/`)
//!    — this is the recommended persistent location for installed `.deb`
//!    users. The `.deb` puts the binary in /usr/bin where they can't drop
//!    a config file, so per-user XDG config dir is the right home.
//! 3. Same directory as the executable (`<bundle>/oauth_config.toml`) —
//!    used by portable / AppImage runs and macOS app bundles.
//! 4. `oauth_config.toml` relative to CWD (dev mode, `cargo run` from src-tauri)
//! 5. `salmon/src-tauri/oauth_config.toml` relative to CWD (dev mode, from
//!    project root)
//!
//! Missing file is NOT an error — `OauthConfig::load()` returns Default()
//! with empty strings. UI will show "未配置" instead of crashing at startup.

use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Default, Clone, Deserialize)]
pub struct OauthConfig {
    #[serde(default)]
    pub google: GoogleConfig,
    #[serde(default)]
    pub microsoft: MicrosoftConfig,
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct GoogleConfig {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct MicrosoftConfig {
    #[serde(default)]
    pub client_id: String,
}

impl OauthConfig {
    pub fn load() -> Self {
        if let Some(path) = resolve_path() {
            if let Ok(text) = std::fs::read_to_string(&path) {
                match toml::from_str::<OauthConfig>(&text) {
                    Ok(cfg) => {
                        eprintln!("[salmon] oauth_config loaded from {}", path.display());
                        return cfg;
                    }
                    Err(e) => {
                        eprintln!("[salmon] oauth_config parse error in {}: {}", path.display(), e);
                    }
                }
            }
        }
        eprintln!("[salmon] oauth_config not found — mail / calendar features will show as unconfigured");
        OauthConfig::default()
    }

    pub fn google_configured(&self) -> bool {
        !self.google.client_id.is_empty() && !self.google.client_secret.is_empty()
    }

    pub fn microsoft_configured(&self) -> bool {
        !self.microsoft.client_id.is_empty()
    }
}

fn resolve_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SALMON_OAUTH_CONFIG") {
        let pb = PathBuf::from(p);
        if pb.exists() { return Some(pb); }
    }
    // XDG config dir — the right home for installed-via-.deb users since
    // /usr/bin/ isn't writable. Prefer $XDG_CONFIG_HOME if set, fall back
    // to ~/.config.
    let xdg = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".config")));
    if let Some(base) = xdg {
        let pb = base.join("salmonapp").join("oauth_config.toml");
        if pb.exists() { return Some(pb); }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let pb = dir.join("oauth_config.toml");
            if pb.exists() { return Some(pb); }
        }
    }
    // dev mode: cargo run from src-tauri/
    let pb = PathBuf::from("oauth_config.toml");
    if pb.exists() { return Some(pb); }
    let pb = PathBuf::from("salmon/src-tauri/oauth_config.toml");
    if pb.exists() { return Some(pb); }
    None
}
