//! Platform-aware data/config/cache/log directory helpers.
//!
//! Tauri's `app.path()` returns OS-correct dirs, but several modules need
//! a path before `AppHandle` is available (e.g. stderr-redirect on startup)
//! or in sync contexts where threading it through is awkward
//! (`save_pasted_image`, `rubric::rubric_path`). These helpers match
//! Tauri's conventions:
//!
//! - macOS: `~/Library/{Application Support,Caches,Logs}/<bundle_id>/`
//! - Linux: respects `$XDG_*_HOME`, falls back to `~/.local/share`,
//!   `~/.cache`, `~/.config`. We keep the short `salmonapp` segment for
//!   config/cache to preserve compatibility with 0.x installs that wrote
//!   to those exact paths — migrating users away from `~/.config/salmonapp/`
//!   would require an opt-in migration we don't ship in 1.0.1.

use std::path::PathBuf;

const BUNDLE_ID: &str = "app.salmonapp.desktop";

/// Log dir. macOS: `~/Library/Logs/<bundle>/`. Linux: `~/.local/share/<bundle>/`
/// — same place Tauri's `app_log_dir()` resolves to on Linux for this app.
pub fn log_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    #[cfg(target_os = "macos")]
    {
        Some(home.join("Library").join("Logs").join(BUNDLE_ID))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some(home.join(".local").join("share").join(BUNDLE_ID))
    }
}

/// User config dir for sibling files (oauth_config.toml, rubric.md).
/// macOS: `~/Library/Application Support/<bundle>/`. Linux: `$XDG_CONFIG_HOME/salmonapp/`
/// or `~/.config/salmonapp/`.
pub fn config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        Some(home.join("Library").join("Application Support").join(BUNDLE_ID))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
        Some(base.join("salmonapp"))
    }
}

/// User cache dir (pasted images, office preview).
/// macOS: `~/Library/Caches/<bundle>/`. Linux: `$XDG_CACHE_HOME/salmonapp/`
/// or `~/.cache/salmonapp/`.
pub fn cache_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        Some(home.join("Library").join("Caches").join(BUNDLE_ID))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let base = std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))?;
        Some(base.join("salmonapp"))
    }
}
