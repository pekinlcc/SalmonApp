//! One-shot LLM call abstraction for the briefing pipeline.
//!
//! Wraps spawning `claude --print` or `codex exec` for a single request and
//! returns the text response. Prompts go via stdin (not argv) so large
//! prompts (per-contact bundles with many emails) don't hit ARG_MAX.
//!
//! Codex emits banner / turn-marker noise on stdout, so we use its `-o
//! <tmpfile>` mode to get a clean final message. Claude's `-p` mode is
//! already clean text.
//!
//! Engine selection: caller picks "claude" or "codex". `pick_engine()` picks
//! the first one with a logged-in credentials file, matching what the
//! existing `commands::recommendation_engines()` does for the recs pipeline.

use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// Hard cap per LLM call. Generously sized — Pulse on a chatty contact +
/// rubric prefix can take 30-60s, Briefing on a busy inbox can hit ~90s.
const LLM_TIMEOUT_SECS: u64 = 180;

/// Pick the first available engine, preferring `claude` over `codex`.
/// "Available" = binary on PATH AND credentials file exists.
pub fn pick_engine() -> Option<String> {
    if engine_ready("claude") {
        return Some("claude".to_string());
    }
    if engine_ready("codex") {
        return Some("codex".to_string());
    }
    None
}

pub fn engine_ready(engine: &str) -> bool {
    if which::which(engine).is_err() {
        return false;
    }
    let Some(home) = std::env::var_os("HOME") else { return false };
    let home = PathBuf::from(home);
    match engine {
        "claude" => home.join(".claude/.credentials.json").exists(),
        "codex" => {
            home.join(".codex/auth.json").exists()
                || home.join(".config/codex/auth.json").exists()
        }
        _ => false,
    }
}

/// Run one LLM call. `system` is prepended to `user` for Codex (it doesn't
/// take a separate system flag); for Claude we use `--append-system-prompt`.
/// Returns the model's raw text response.
pub async fn call_llm(engine: &str, system: &str, user: &str) -> Result<String> {
    let bin = which::which(engine).map_err(|e| anyhow!("{}: {}", engine, e))?;
    let workdir =
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

    match engine {
        "claude" => call_claude(&bin, &workdir, system, user).await,
        "codex" => call_codex(&bin, &workdir, system, user).await,
        other => Err(anyhow!("unsupported engine: {}", other)),
    }
}

async fn call_claude(
    bin: &std::path::Path,
    workdir: &str,
    system: &str,
    user: &str,
) -> Result<String> {
    let mut cmd = Command::new(bin);
    cmd.current_dir(workdir)
        .arg("-p")
        .arg("--max-turns")
        .arg("1")
        .arg("--output-format")
        .arg("text");
    if !system.is_empty() {
        cmd.arg("--append-system-prompt").arg(system);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().context("spawn claude")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(user.as_bytes())
            .await
            .context("write claude stdin")?;
        drop(stdin);
    }
    let output = tokio::time::timeout(
        Duration::from_secs(LLM_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| anyhow!("claude timed out after {}s", LLM_TIMEOUT_SECS))?
    .context("wait claude")?;
    if !output.status.success() {
        return Err(anyhow!(
            "claude exited {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn call_codex(
    bin: &std::path::Path,
    workdir: &str,
    system: &str,
    user: &str,
) -> Result<String> {
    // Codex spits banner + turn markers to stdout. Per ThunderClaw's
    // research, `-o <tmpfile>` writes ONLY the final assistant message,
    // which is what we want. tmpfile auto-cleans on drop.
    let tmp = tempfile_path();
    let mut cmd = Command::new(bin);
    cmd.current_dir(workdir)
        .arg("exec")
        .arg("--skip-git-repo-check")
        .arg("--color")
        .arg("never")
        .arg("-o")
        .arg(&tmp);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().context("spawn codex")?;
    if let Some(mut stdin) = child.stdin.take() {
        // Codex has no system-prompt flag; prepend system inline.
        let combined = if system.is_empty() {
            user.to_string()
        } else {
            format!("[SYSTEM]\n{}\n[/SYSTEM]\n\n{}", system, user)
        };
        stdin
            .write_all(combined.as_bytes())
            .await
            .context("write codex stdin")?;
        drop(stdin);
    }
    let status = tokio::time::timeout(
        Duration::from_secs(LLM_TIMEOUT_SECS),
        child.wait(),
    )
    .await
    .map_err(|_| anyhow!("codex timed out after {}s", LLM_TIMEOUT_SECS))?
    .context("wait codex")?;
    if !status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(anyhow!("codex exited {:?}", status.code()));
    }
    let text = std::fs::read_to_string(&tmp).context("read codex tmpfile")?;
    let _ = std::fs::remove_file(&tmp);
    Ok(text)
}

fn tempfile_path() -> PathBuf {
    let mut p = std::env::temp_dir();
    let n = uuid::Uuid::new_v4().simple();
    p.push(format!("salmon-codex-{}.txt", n));
    p
}

/// Extract the first balanced `{…}` JSON object from arbitrary text. LLM
/// output often includes prose before/after the JSON or ```json fences;
/// this finds the first `{`, then scans forward counting braces (string-
/// aware), and returns that substring. Returns None if no balanced object
/// exists.
pub fn extract_json_object(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let start = bytes.iter().position(|&b| b == b'{')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return std::str::from_utf8(&bytes[start..=i]).ok().map(String::from);
                }
            }
            _ => {}
        }
    }
    None
}

/// Same but for `[...]` arrays at the top level. Used when prompts ask the
/// model to return a bare array.
pub fn extract_json_array(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let start = bytes.iter().position(|&b| b == b'[')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return std::str::from_utf8(&bytes[start..=i]).ok().map(String::from);
                }
            }
            _ => {}
        }
    }
    None
}

/// Truncate a string to at most `max_chars` (Unicode codepoint count), with
/// an "…[+N]" suffix on truncation. Used to budget prompt sizes — emails
/// can be huge and Claude/Codex both have context limits.
pub fn truncate_chars(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars {
        return s.to_string();
    }
    let head: String = s.chars().take(max_chars).collect();
    format!("{}…[+{}]", head, count - max_chars)
}

