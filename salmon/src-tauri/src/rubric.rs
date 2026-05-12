//! `rubric.md` — the user's importance-judgement criteria, AI-maintained
//! but human-readable + editable. Loaded into every Pulse / Briefing /
//! Writer prompt as part of the system message.
//!
//! Lifecycle:
//! - First load: file missing → write DEFAULT_RUBRIC + return it
//! - Subsequent loads: read from disk
//! - Save: atomic (write to .tmp, rename), back up old to .bak first
//! - User edits: detected via mtime; if mtime > last_ai_write_mtime, the
//!   user's version becomes the new baseline and AI never overwrites it
//!   without explicit re-merge
//!
//! Storage location: `$XDG_CONFIG_HOME/salmonapp/rubric.md`, or
//! `~/.config/salmonapp/rubric.md`. Sibling of `oauth_config.toml`.
//!
//! The Editor agent (a separate LLM call) is triggered when feedback_log
//! has >= 10 unconsumed entries OR the last edit was >= 24h ago.
//! Implementation: `briefing_orchestrator::maybe_edit_rubric()`.

use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;

const MAX_BYTES: usize = 4 * 1024;
const MAX_LINES: usize = 200;

pub const DEFAULT_RUBRIC: &str = r#"# SalmonApp Rubric · v1

## 用户画像
*尚未生成 · 累积 ~20 条用户处置反馈后由 Editor agent 填充*

## 重要性判定

### 高（high · 现在就该看）
- VIP 联系人发来的邮件，且需要回复或决定
- 含具体截止时间且 < 48h 的请求
- 上司 / 客户 / 抄送 CEO 的协调类邮件
- 正在进行中的 Topic 卡在等用户授权 / 错误状态 > 1h

### 中（medium · 今天看完）
- 含 deadline 但 > 48h 的事项
- 同事的常规协作请求
- 14 天内活跃的 Topic 出现"需要决定"信号

### 低（low · 可批量处理）
- bot 通知（GitHub / Jira / Calendly 自动邮件）
- 单方面通报，不需要回复
- 已读但未归档的旧消息

### 过滤（filter · 不进 feed）
- 营销 / newsletter / 群发促销
- 自动回复 / out-of-office
- 用户曾标记"不重要"的 thread

## 联系人画像
*待 Editor 学习用户的 ack / mute 反馈后填充*

## 学到的模式
*待累积*
"#;

pub fn rubric_path() -> Result<PathBuf> {
    let base = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| PathBuf::from(h).join(".config"))
        })
        .ok_or_else(|| anyhow!("no XDG_CONFIG_HOME / HOME"))?;
    Ok(base.join("salmonapp").join("rubric.md"))
}

pub fn load() -> Result<String> {
    let path = rubric_path()?;
    if !path.exists() {
        // First-run seed.
        let _ = save(DEFAULT_RUBRIC);
        return Ok(DEFAULT_RUBRIC.to_string());
    }
    let text = std::fs::read_to_string(&path).context("read rubric")?;
    if text.trim().is_empty() {
        return Ok(DEFAULT_RUBRIC.to_string());
    }
    Ok(text)
}

pub fn save(content: &str) -> Result<()> {
    let bytes = content.as_bytes();
    if bytes.len() > MAX_BYTES {
        return Err(anyhow!(
            "rubric exceeds {} bytes ({} actual) — Editor must compact",
            MAX_BYTES,
            bytes.len()
        ));
    }
    if content.lines().count() > MAX_LINES {
        return Err(anyhow!(
            "rubric exceeds {} lines — Editor must compact",
            MAX_LINES
        ));
    }
    let path = rubric_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("mkdir rubric dir")?;
    }
    // Backup existing.
    if path.exists() {
        let bak = path.with_extension("md.bak");
        let _ = std::fs::copy(&path, &bak);
    }
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, content).context("write rubric tmp")?;
    std::fs::rename(&tmp, &path).context("rename rubric")?;
    Ok(())
}

/// Last modification time as epoch-ms. None if the file doesn't exist.
pub fn last_modified_ms() -> Option<i64> {
    let path = rubric_path().ok()?;
    let meta = std::fs::metadata(&path).ok()?;
    let modified = meta.modified().ok()?;
    let dur = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as i64)
}
