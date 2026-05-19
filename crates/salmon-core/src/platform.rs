//! Platform-specific glue. Linux is the historical baseline; everything
//! that needs to be different on macOS lives here behind `cfg` so the
//! call sites in `commands.rs` / `engine.rs` stay platform-agnostic.

use std::path::PathBuf;

/// Make `which::which()` work the same way the user's terminal does.
///
/// On macOS, GUI apps launched from Finder/Dock inherit a stripped PATH
/// (typically `/usr/bin:/bin:/usr/sbin:/sbin`). Tools that users install
/// via Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) or `npm i -g`
/// (`~/.npm-global/bin`, `~/.nvm/...`) are invisible — so `which::which("claude")`
/// fails even though the same command works in Terminal.
///
/// We fix this by:
///   1. Asking the user's login shell what PATH it sees (`$SHELL -ilc 'echo $PATH'`)
///   2. Falling back to a static list of common Homebrew / Node global paths
///
/// On Linux this is a no-op for the regular Tauri-inside-GNOME case (GNOME
/// inherits the user's PATH), but it is NOT a no-op when running as the
/// SalmonApp Desktop labwc session: GDM-launched compositors get a stripped
/// PATH and can't see `~/.nvm/...`, `~/.local/bin`, etc.
pub fn fix_path_for_gui() {
    #[cfg(target_os = "macos")]
    {
        if let Some(shell_path) = ask_login_shell_for_path() {
            prepend_paths(&shell_path);
        }
        prepend_paths("/opt/homebrew/bin:/usr/local/bin");
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            for sub in [".npm-global/bin", ".bun/bin", ".cargo/bin", ".local/bin"] {
                let p = home.join(sub);
                if p.exists() {
                    prepend_paths(&p.to_string_lossy());
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let in_salmon_session = std::env::var("XDG_CURRENT_DESKTOP")
            .map(|v| v.contains("SalmonApp"))
            .unwrap_or(false)
            || std::env::var("DESKTOP_SESSION")
                .map(|v| v == "salmon-shell")
                .unwrap_or(false);
        if !in_salmon_session {
            return;
        }
        if let Some(shell_path) = ask_login_shell_for_path() {
            prepend_paths(&shell_path);
        }
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            for sub in [".local/bin", ".cargo/bin", ".bun/bin", ".npm-global/bin"] {
                let p = home.join(sub);
                if p.exists() {
                    prepend_paths(&p.to_string_lossy());
                }
            }
            let nvm_versions = home.join(".nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                for e in entries.flatten() {
                    let b = e.path().join("bin");
                    if b.exists() {
                        prepend_paths(&b.to_string_lossy());
                    }
                }
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn ask_login_shell_for_path() -> Option<String> {
    use std::process::Command;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // -i (interactive) sources rc files; -l (login) sources profile files.
    // We wrap the output in markers so any noise from the user's rc files
    // (motd, fortune, etc.) doesn't poison our parse.
    let out = Command::new(&shell)
        .args([
            "-ilc",
            "printf '__SALMON_PATH_BEGIN__\\n%s\\n__SALMON_PATH_END__\\n' \"$PATH\"",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let p = stdout
        .split("__SALMON_PATH_BEGIN__")
        .nth(1)?
        .split("__SALMON_PATH_END__")
        .next()?
        .trim();
    if p.is_empty() {
        None
    } else {
        Some(p.to_string())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn prepend_paths(extra: &str) {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut seen: Vec<String> = current.split(':').map(|s| s.to_string()).collect();
    let mut additions: Vec<String> = Vec::new();
    for p in extra.split(':') {
        if p.is_empty() {
            continue;
        }
        if !seen.iter().any(|s| s == p) {
            additions.push(p.to_string());
            seen.push(p.to_string());
        }
    }
    if additions.is_empty() {
        return;
    }
    additions.extend(current.split(':').filter(|s| !s.is_empty()).map(String::from));
    std::env::set_var("PATH", additions.join(":"));
}

/// Locate LibreOffice's headless converter.
///
/// On Linux the binary is normally just `soffice` on PATH (after
/// `apt install libreoffice-impress`). On macOS the official LibreOffice
/// installer drops the binary inside `/Applications/LibreOffice.app/Contents/MacOS/soffice`
/// and does not symlink it onto PATH, so `which("soffice")` returns nothing
/// even when the app is installed.
pub fn find_soffice() -> Option<PathBuf> {
    if let Ok(p) = which::which("soffice") {
        return Some(p);
    }
    #[cfg(target_os = "macos")]
    {
        for candidate in [
            "/Applications/LibreOffice.app/Contents/MacOS/soffice",
            "/opt/homebrew/bin/soffice",
        ] {
            let pb = PathBuf::from(candidate);
            if pb.exists() {
                return Some(pb);
            }
        }
    }
    None
}

/// Human-readable hint shown when LibreOffice/Poppler aren't installed.
/// Different package manager per platform.
pub fn install_hint_for_office_preview() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "未找到 LibreOffice。安装一次:从 https://www.libreoffice.org/download/ 下载, \
         或 `brew install --cask libreoffice` 并安装 `brew install poppler`。"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "未找到 LibreOffice。安装一次:`sudo apt install libreoffice-impress \
         libreoffice-writer libreoffice-calc poppler-utils`。"
    }
}
