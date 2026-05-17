//! Load OAuth credentials from `oauth_config.toml`. Resolution order:
//!
//! 1. `$SALMON_OAUTH_CONFIG` env var if set (absolute path)
//! 2. Platform user-config dir (see `path_dirs::config_dir`):
//!    - Linux: `$XDG_CONFIG_HOME/salmonapp/oauth_config.toml` (`~/.config/salmonapp/...`)
//!    - macOS: `~/Library/Application Support/app.salmonapp.desktop/oauth_config.toml`
//!    This is the recommended persistent location for installed-via-bundle
//!    users since the binary lives in a read-only location.
//! 3. Same directory as the executable — used by portable / AppImage runs.
//!    Note this does NOT work for signed macOS .app bundles (Contents/MacOS
//!    is read-only), which is why option 2 above is critical for Mac.
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
        is_filled(&self.google.client_id) && is_filled(&self.google.client_secret)
    }

    pub fn microsoft_configured(&self) -> bool {
        is_filled(&self.microsoft.client_id)
    }
}

fn is_filled(value: &str) -> bool {
    let v = value.trim();
    !v.is_empty()
        && !v.contains("PASTE")
        && !v.contains("____")
        && !v.contains("YOUR-")
}

pub fn config_file_path() -> Option<PathBuf> {
    crate::path_dirs::config_dir().map(|base| base.join("oauth_config.toml"))
}

fn resolve_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SALMON_OAUTH_CONFIG") {
        let pb = PathBuf::from(p);
        if pb.exists() { return Some(pb); }
    }
    if let Some(pb) = config_file_path() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_values_are_not_configured() {
        let cfg = OauthConfig {
            google: GoogleConfig {
                client_id: "PASTE-YOUR-GOOGLE-CLIENT-ID.apps.googleusercontent.com".into(),
                client_secret: "PASTE-YOUR-GOOGLE-CLIENT-SECRET".into(),
            },
            microsoft: MicrosoftConfig {
                client_id: "____-____-____-____".into(),
            },
        };

        assert!(!cfg.google_configured());
        assert!(!cfg.microsoft_configured());
    }

    #[test]
    fn real_values_are_configured() {
        let cfg = OauthConfig {
            google: GoogleConfig {
                client_id: "abc.apps.googleusercontent.com".into(),
                client_secret: "GOCSPX-secret".into(),
            },
            microsoft: MicrosoftConfig {
                client_id: "12345678-abcd-1234-abcd-123456789abc".into(),
            },
        };

        assert!(cfg.google_configured());
        assert!(cfg.microsoft_configured());
    }
}
