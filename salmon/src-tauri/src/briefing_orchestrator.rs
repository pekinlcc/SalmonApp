//! Orchestrator — runs the full briefing pipeline:
//!
//!   1. Roost: aggregate mail+calendar by contact (sync, fast)
//!   2. Pulse: one LLM call per contact, in parallel up to MAX_CONCURRENCY
//!   3. Briefing: one LLM call to dedup / rank / write overview
//!   4. (Topic side: read from `recommendations` table — already populated
//!      by the existing `generate_recommendations` command)
//!   5. Cross-link: one LLM call comparing mail items vs topic recs
//!   6. Write to brief_items + briefing_state
//!
//! Emits `salmon-briefing-progress` events to the FE throughout.
//!
//! On LLM unavailability (no CLI / token expired), falls back to
//! pure heuristic: each PulseItem from Roost is a card, no merging.
//! Better than nothing.

use crate::briefing_llm;
use crate::cross_link;
use crate::db::Db;
use crate::llm;
use crate::pulse::{self, PulseItem, SuggestedAction, ActionStep};
use crate::roost;
use crate::rubric;
use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use rusqlite::params;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const MAX_PARALLEL_PULSE: usize = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingProgress {
    pub stage: String,
    pub current: usize,
    pub total: usize,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingRunResult {
    pub briefing_id: String,
    pub item_count: usize,
    pub overview: String,
    pub used_llm: bool,
}

pub async fn run_briefing(
    app: AppHandle,
    db: Arc<Mutex<Db>>,
) -> Result<BriefingRunResult> {
    let briefing_id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().timestamp_millis();
    emit(&app, "starting", 0, 0, None);

    // ── Pick engine + load rubric ───────────────────────────────────
    let engine = llm::pick_engine();
    let used_llm = engine.is_some();
    let rubric_text = rubric::load().unwrap_or_else(|_| rubric::DEFAULT_RUBRIC.to_string());

    // ── Roost ────────────────────────────────────────────────────────
    emit(&app, "roost", 0, 0, None);
    let bundles = {
        let guard = db.lock();
        roost::build_bundles(&guard, roost::LOOKBACK_DAYS_BRIEFING, None).context("roost")?
    };
    emit(&app, "roost", bundles.len(), bundles.len(), Some(format!("{} contact(s)", bundles.len())));

    // ── Pulse (per contact) ─────────────────────────────────────────
    let mut per_contact: Vec<(String, Option<String>, Vec<PulseItem>)> = Vec::new();
    if let Some(eng) = engine.as_deref() {
        emit(&app, "pulse", 0, bundles.len(), None);
        // Run concurrently with a small parallelism cap. Each call spawns
        // a subprocess, so 3 at a time is plenty.
        let total = bundles.len();
        let mut handles: Vec<tokio::task::JoinHandle<_>> = Vec::new();
        let sem = Arc::new(tokio::sync::Semaphore::new(MAX_PARALLEL_PULSE));
        for (idx, bundle) in bundles.iter().enumerate() {
            let bundle = bundle.clone();
            let eng = eng.to_string();
            let rubric_text = rubric_text.clone();
            let sem = sem.clone();
            let app = app.clone();
            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire_owned().await.ok();
                let result = pulse::analyse_contact(&eng, &rubric_text, &bundle).await;
                let _ = app.emit(
                    "salmon-briefing-progress",
                    BriefingProgress {
                        stage: "pulse".into(),
                        current: idx + 1,
                        total,
                        note: Some(format!("{} ({})", bundle.email, bundle.messages.len())),
                    },
                );
                (bundle.email, bundle.display_name, result)
            }));
        }
        for h in handles {
            if let Ok((email, name, res)) = h.await {
                match res {
                    Ok(items) => per_contact.push((email, name, items)),
                    Err(e) => {
                        eprintln!("[salmon][pulse] {} failed: {}", email, e);
                        // Drop this contact's items but keep going.
                    }
                }
            }
        }
    } else {
        eprintln!("[salmon][briefing] no LLM engine — skipping Pulse, using heuristic fallback");
    }

    // Flatten for Briefing.
    let mut flat: Vec<(String, Option<String>, PulseItem)> = Vec::new();
    for (email, name, items) in per_contact {
        for it in items {
            flat.push((email.clone(), name.clone(), it));
        }
    }

    // ── Global Briefing (dedup + rank + overview) ──────────────────
    let global = if let Some(eng) = engine.as_deref() {
        if flat.is_empty() {
            briefing_llm::GlobalBriefing {
                overview: "暂无需要现在处理的事项".into(),
                ordered_indices: Vec::new(),
                merge_groups: Vec::new(),
            }
        } else {
            emit(&app, "briefing", 0, 1, None);
            match briefing_llm::rank_and_dedup(eng, &rubric_text, &flat).await {
                Ok(g) => g,
                Err(e) => {
                    eprintln!("[salmon][briefing] global step failed: {} — falling back", e);
                    briefing_llm::GlobalBriefing {
                        overview: format!("{} 件事项 (全局排序失败，按时间倒序展示)", flat.len()),
                        ordered_indices: (0..flat.len()).collect(),
                        merge_groups: Vec::new(),
                    }
                }
            }
        }
    } else {
        briefing_llm::GlobalBriefing {
            overview: format!("{} 件事项 (LLM 未配置, 启发式)", flat.len()),
            ordered_indices: (0..flat.len()).collect(),
            merge_groups: Vec::new(),
        }
    };

    // ── Topic side: read existing recommendations ──────────────────
    let topic_recs = load_pending_recommendations(&db);

    // ── Cross-link mail ↔ topic ────────────────────────────────────
    emit(&app, "cross-link", 0, 1, None);
    let mail_summaries: Vec<cross_link::MailSummary> = flat
        .iter()
        .enumerate()
        .map(|(i, (email, _, it))| cross_link::MailSummary {
            id: format!("mail-{}", i),
            title: it.title.clone(),
            why: it.why.clone(),
            contact_email: email.clone(),
            priority: it.priority.clone(),
        })
        .collect();
    let topic_summaries: Vec<cross_link::TopicSummary> = topic_recs
        .iter()
        .map(|r| cross_link::TopicSummary {
            id: r.id.clone(),
            topic_id: r.topic_id.clone().unwrap_or_default(),
            topic_title: r.topic_title.clone(),
            workdir: r.workdir.clone(),
            title: r.title.clone(),
            rationale: r.rationale.clone(),
        })
        .collect();
    let cross_links = if let Some(eng) = engine.as_deref() {
        cross_link::cross_link(eng, &mail_summaries, &topic_summaries)
            .await
            .unwrap_or_else(|e| {
                eprintln!("[salmon][cross-link] failed: {}", e);
                Vec::new()
            })
    } else {
        Vec::new()
    };

    // ── Persist brief_items ────────────────────────────────────────
    let now_ms = chrono::Utc::now().timestamp_millis();
    // Safety net: expire pending items older than 24h. Unaffected by the
    // supersede sweep below — that one is failure-safe (only runs after
    // a successful write_items); this one is a separate "stale cleanup"
    // concern and shouldn't depend on whether a new run completes.
    {
        let guard = db.lock();
        let _ = guard.conn().execute(
            "UPDATE brief_items SET status='expired', decided_at=?
             WHERE status='pending' AND created_at < ?",
            params![now_ms, now_ms - 24 * 3600_000],
        );
    }
    let item_count = write_items(
        &db,
        &briefing_id,
        now_ms,
        &flat,
        &global,
        &topic_recs,
        &cross_links,
    )
    .context("persist brief_items")?;

    // v1.1.3: supersede prior pending items AFTER write_items succeeds.
    // Order matters — if we superseded first and write_items failed (DB
    // error, JSON serialization fault, etc.) the user would lose all
    // their pending cards with nothing to replace them. By writing
    // first and superseding everything-except-this-run after, a failed
    // write leaves prior pending intact and the user sees no regression.
    {
        let guard = db.lock();
        let _ = guard.conn().execute(
            "UPDATE brief_items SET status='superseded', decided_at=?
             WHERE status='pending' AND briefing_id != ?",
            params![now_ms, briefing_id],
        );
    }

    // Update briefing_state to point at this new run.
    {
        let guard = db.lock();
        guard.conn().execute(
            "INSERT INTO briefing_state(key, briefing_id, generated_at, overview, rubric_version, rubric_mtime_ms)
             VALUES('current', ?, ?, ?, 1, ?)
             ON CONFLICT(key) DO UPDATE SET
               briefing_id = excluded.briefing_id,
               generated_at = excluded.generated_at,
               overview = excluded.overview,
               rubric_mtime_ms = excluded.rubric_mtime_ms",
            params![
                briefing_id,
                now_ms,
                global.overview,
                rubric::last_modified_ms(),
            ],
        )?;
    }

    emit(&app, "done", item_count, item_count, None);
    eprintln!(
        "[salmon][briefing] done in {} ms · {} items · engine={:?} · cross={}",
        now_ms - started_at,
        item_count,
        engine,
        cross_links.len(),
    );

    Ok(BriefingRunResult {
        briefing_id,
        item_count,
        overview: global.overview,
        used_llm,
    })
}

struct RecRow {
    id: String,
    topic_id: Option<String>,
    topic_title: String,
    workdir: String,
    engine: String,
    title: String,
    rationale: String,
    action_hint: String,
    payoff: String,
    priority: String,
}

fn load_pending_recommendations(db: &Arc<Mutex<Db>>) -> Vec<RecRow> {
    let guard = db.lock();
    let mut stmt = match guard.conn().prepare(
        "SELECT r.id, r.topic_id, t.title, t.workdir, r.source_engine,
                r.title, r.rationale, r.action_hint, r.payoff, r.priority
         FROM recommendations r
         LEFT JOIN topics t ON t.id = r.topic_id
         WHERE r.status = 'pending'
         ORDER BY r.generated_at DESC
         LIMIT 20",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = match stmt.query_map([], |r| {
        Ok(RecRow {
            id: r.get(0)?,
            topic_id: r.get(1)?,
            topic_title: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            workdir: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            engine: r.get(4)?,
            title: r.get(5)?,
            rationale: r.get(6)?,
            action_hint: r.get(7)?,
            payoff: r.get::<_, Option<String>>(8)?.unwrap_or_default(),
            priority: r.get(9)?,
        })
    }) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(|r| r.ok()).collect()
}

fn write_items(
    db: &Arc<Mutex<Db>>,
    briefing_id: &str,
    now_ms: i64,
    flat: &[(String, Option<String>, PulseItem)],
    global: &briefing_llm::GlobalBriefing,
    topic_recs: &[RecRow],
    cross_links: &[cross_link::CrossLink],
) -> Result<usize> {
    // Build a set of mail indices and topic-rec ids that are covered by
    // cross-links — these don't get their own standalone row.
    let mut cross_consumed_mail: std::collections::HashSet<usize> = std::collections::HashSet::new();
    let mut cross_consumed_topic: std::collections::HashSet<String> = std::collections::HashSet::new();
    for link in cross_links {
        for mid in &link.mail_ids {
            if let Some(idx) = mid.strip_prefix("mail-").and_then(|n| n.parse::<usize>().ok()) {
                cross_consumed_mail.insert(idx);
            }
        }
        for tid in &link.topic_rec_ids {
            cross_consumed_topic.insert(tid.clone());
        }
    }

    // Build mail-side cards in global-ordered order, skipping those that
    // got eaten by cross-links and respecting merge_groups (only first index
    // in each group emits a card, but we attach the others' mail ids to it).
    let mut group_lookup: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
    let mut skip_idx: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for group in &global.merge_groups {
        if group.is_empty() { continue }
        let head = group[0];
        let tail: Vec<usize> = group[1..].iter().copied().collect();
        for &t in &tail { skip_idx.insert(t); }
        group_lookup.insert(head, tail);
    }

    let guard = db.lock();
    let mut count = 0usize;

    let priority_score = |p: &str| -> f64 {
        match p { "high" => 3.0, "medium" => 2.0, _ => 1.0 }
    };

    // Cross-link cards first (highest priority by design).
    for link in cross_links {
        let id = uuid::Uuid::new_v4().to_string();
        // Collect related ids: actual mail_messages.id (not the "mail-N"
        // alias) by walking back through flat[].
        let mut related_mail_ids: Vec<String> = Vec::new();
        let mut related_event_ids: Vec<String> = Vec::new();
        let mut suggested: Vec<SuggestedAction> = Vec::new();
        let mut contact: Option<String> = None;
        for mid in &link.mail_ids {
            if let Some(idx) = mid.strip_prefix("mail-").and_then(|n| n.parse::<usize>().ok()) {
                if let Some((email, _, item)) = flat.get(idx) {
                    if contact.is_none() { contact = Some(email.clone()); }
                    related_mail_ids.extend(item.related_mail_ids.clone());
                    related_event_ids.extend(item.related_event_ids.clone());
                    suggested.extend(item.suggested_actions.clone());
                }
            }
        }
        // Topic ids
        let mut related_topic_ids: Vec<String> = Vec::new();
        for rid in &link.topic_rec_ids {
            if let Some(rec) = topic_recs.iter().find(|r| &r.id == rid) {
                if let Some(tid) = &rec.topic_id {
                    related_topic_ids.push(tid.clone());
                }
            }
        }
        // Always include an ack fallback.
        if !suggested.iter().any(|a| a.steps.iter().any(|s| s.kind == "acknowledge")) {
            suggested.push(SuggestedAction {
                label: "我已知晓".into(),
                steps: vec![ActionStep { kind: "acknowledge".into(), detail: String::new() }],
            });
        }

        guard.conn().execute(
            "INSERT INTO brief_items
               (id, briefing_id, kind, priority, title, summary, why,
                contact_email, topic_id, related_mail_ids, related_topic_ids,
                related_event_ids, suggested_actions, status, score, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)",
            params![
                id,
                briefing_id,
                "cross",
                link.combined_priority,
                link.combined_title,
                None::<String>,
                link.combined_why,
                contact,
                related_topic_ids.first().cloned(),
                serde_json::to_string(&related_mail_ids)?,
                serde_json::to_string(&related_topic_ids)?,
                serde_json::to_string(&related_event_ids)?,
                serde_json::to_string(&suggested)?,
                priority_score(&link.combined_priority) + 1.0, // cross-link gets a small bump
                now_ms,
            ],
        )?;
        count += 1;
    }

    // Mail items in ranked order (skip cross-consumed + merge tails).
    for &idx in &global.ordered_indices {
        if cross_consumed_mail.contains(&idx) || skip_idx.contains(&idx) {
            continue;
        }
        let Some((email, _name, item)) = flat.get(idx) else { continue };
        let id = uuid::Uuid::new_v4().to_string();
        let mut related_mail_ids = item.related_mail_ids.clone();
        let mut related_event_ids = item.related_event_ids.clone();
        let mut suggested = item.suggested_actions.clone();
        // Pull in tail items from merge group.
        if let Some(tail) = group_lookup.get(&idx) {
            for &t in tail {
                if let Some((_, _, ti)) = flat.get(t) {
                    related_mail_ids.extend(ti.related_mail_ids.clone());
                    related_event_ids.extend(ti.related_event_ids.clone());
                }
            }
        }
        if !suggested.iter().any(|a| a.steps.iter().any(|s| s.kind == "acknowledge")) {
            suggested.push(SuggestedAction {
                label: "我已知晓".into(),
                steps: vec![ActionStep { kind: "acknowledge".into(), detail: String::new() }],
            });
        }

        guard.conn().execute(
            "INSERT INTO brief_items
               (id, briefing_id, kind, priority, title, summary, why,
                contact_email, topic_id, related_mail_ids, related_topic_ids,
                related_event_ids, suggested_actions, status, score, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)",
            params![
                id,
                briefing_id,
                "mail",
                item.priority,
                item.title,
                item.summary,
                item.why,
                email,
                None::<String>,
                serde_json::to_string(&related_mail_ids)?,
                serde_json::to_string(&Vec::<String>::new())?,
                serde_json::to_string(&related_event_ids)?,
                serde_json::to_string(&suggested)?,
                priority_score(&item.priority),
                now_ms,
            ],
        )?;
        count += 1;
    }

    // Topic recs in their existing priority order (skip cross-consumed).
    for rec in topic_recs {
        if cross_consumed_topic.contains(&rec.id) {
            continue;
        }
        let id = uuid::Uuid::new_v4().to_string();
        // Construct a sensible suggestedActions for topic recs:
        //   - "前往 Topic 并发送动作"  (kind=acknowledge with detail steering FE)
        //   - "我已知晓"
        let actions = vec![
            SuggestedAction {
                label: format!("前往 Topic · {}", truncate(&rec.action_hint, 22)),
                steps: vec![ActionStep {
                    kind: "acknowledge".into(),
                    detail: format!("open_topic:{}", rec.topic_id.clone().unwrap_or_default()),
                }],
            },
            SuggestedAction {
                label: "我已知晓".into(),
                steps: vec![ActionStep { kind: "acknowledge".into(), detail: String::new() }],
            },
        ];
        guard.conn().execute(
            "INSERT INTO brief_items
               (id, briefing_id, kind, priority, title, summary, why,
                contact_email, topic_id, related_mail_ids, related_topic_ids,
                related_event_ids, suggested_actions, status, score, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)",
            params![
                id,
                briefing_id,
                "topic",
                rec.priority,
                rec.title,
                rec.payoff,
                rec.rationale,
                None::<String>,
                rec.topic_id,
                serde_json::to_string(&Vec::<String>::new())?,
                serde_json::to_string(&vec![rec.topic_id.clone().unwrap_or_default()])?,
                serde_json::to_string(&Vec::<String>::new())?,
                serde_json::to_string(&actions)?,
                priority_score(&rec.priority),
                now_ms,
            ],
        )?;
        count += 1;
    }

    Ok(count)
}

fn truncate(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max { return s.to_string(); }
    s.chars().take(max).collect::<String>() + "…"
}

fn emit(app: &AppHandle, stage: &str, current: usize, total: usize, note: Option<String>) {
    let _ = app.emit(
        "salmon-briefing-progress",
        BriefingProgress {
            stage: stage.to_string(),
            current,
            total,
            note,
        },
    );
}

/// Editor agent — looks at feedback_log entries since last consumption and
/// asks the LLM to fold them into rubric.md. Triggered by orchestrator
/// when ≥10 unconsumed entries OR 24h since last rubric mtime.
pub async fn maybe_edit_rubric(db: Arc<Mutex<Db>>) -> Result<bool> {
    // Each unconsumed row: (id, ts_local_str, kind, item_title, detail).
    struct FeedbackEntry {
        id: i64,
        ts_local: String,
        kind: String,
        title: Option<String>,
        detail: Option<String>,
    }
    let (entries, last_consumed_id) = {
        let guard = db.lock();
        let last_consumed_id = guard
            .conn()
            .query_row(
                "SELECT feedback_consumed_id FROM briefing_state WHERE key='current'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0);
        let mut stmt = guard.conn().prepare(
            "SELECT id, ts, kind, item_title, detail
             FROM feedback_log WHERE id > ? AND consumed = 0
             ORDER BY ts ASC LIMIT 200",
        )?;
        let rows = stmt.query_map(params![last_consumed_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?;
        let collected: Vec<FeedbackEntry> = rows
            .filter_map(|r| r.ok())
            .map(|(id, ts, kind, title, detail)| {
                let ts_local = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ts)
                    .map(|t| t.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_else(|| "?".into());
                FeedbackEntry { id, ts_local, kind, title, detail }
            })
            .collect();
        (collected, last_consumed_id)
    };
    if entries.len() < 10 {
        return Ok(false);
    }
    let engine = match llm::pick_engine() {
        Some(e) => e,
        None => return Ok(false),
    };
    let current_rubric = rubric::load()?;
    let prompt = format!(
        "用户最近的处置反馈如下，请把\"学到的模式\"章节增量更新到 rubric.md。\
         **只改\"用户画像\"和\"学到的模式\"两段，其他章节不动**。整份 < 4KB / 200 行。\
         直接输出新版 rubric.md 全文，不要加任何前缀或代码块。\n\n\
         【当前 rubric】\n{}\n\n【新反馈】\n{}\n",
        current_rubric,
        entries
            .iter()
            .map(|e| format!(
                "[{}] {} {} - 标题: {} - 详情: {}",
                e.id,
                e.ts_local,
                e.kind,
                e.title.as_deref().unwrap_or(""),
                e.detail.as_deref().unwrap_or("")
            ))
            .collect::<Vec<_>>()
            .join("\n"),
    );
    let raw = llm::call_llm(&engine, "", &prompt).await?;
    if raw.trim().is_empty() {
        return Err(anyhow!("Editor returned empty rubric"));
    }
    rubric::save(raw.trim())?;
    let max_id = entries.iter().map(|e| e.id).max().unwrap_or(last_consumed_id);
    let guard = db.lock();
    guard.conn().execute(
        "UPDATE feedback_log SET consumed = 1 WHERE id <= ?",
        params![max_id],
    )?;
    guard.conn().execute(
        "UPDATE briefing_state SET feedback_consumed_id = ?, rubric_mtime_ms = ?
         WHERE key='current'",
        params![max_id, rubric::last_modified_ms()],
    )?;
    Ok(true)
}
