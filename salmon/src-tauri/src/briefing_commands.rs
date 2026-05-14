//! Tauri commands for the v0.9.1 briefing pipeline.
//!
//! - run_briefing  : spawn the orchestrator; emits salmon-briefing-progress
//! - list_brief_items : read current briefing from DB
//! - execute_action_step : dispatch reply / calendar / acknowledge
//! - decide_brief_item : ack / mute / act feedback
//! - get_rubric / set_rubric : rubric.md file IO
//! - get_briefing_status : last run + engine availability

use crate::briefing_orchestrator;
use crate::event_extractor;
use crate::llm;
use crate::pulse::SuggestedAction;
use crate::rubric;
use crate::writer;
use crate::AppState;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

fn map_err<E: std::fmt::Display>(e: E) -> String {
    format!("{e}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefItem {
    pub id: String,
    pub briefing_id: String,
    pub kind: String,
    pub priority: String,
    pub title: String,
    pub summary: Option<String>,
    pub why: Option<String>,
    pub contact_email: Option<String>,
    pub topic_id: Option<String>,
    pub related_mail_ids: Vec<String>,
    pub related_topic_ids: Vec<String>,
    pub related_event_ids: Vec<String>,
    pub suggested_actions: Vec<SuggestedAction>,
    pub status: String,
    pub score: f64,
    pub created_at: i64,
    pub decided_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingStatus {
    pub current_briefing_id: Option<String>,
    pub generated_at: Option<i64>,
    pub overview: Option<String>,
    pub engine_available: bool,
    pub engine: Option<String>,
    pub rubric_path: String,
}

#[tauri::command]
pub fn get_briefing_status(state: State<'_, AppState>) -> Result<BriefingStatus, String> {
    let db = state.db.lock();
    let (id, ts, overview): (Option<String>, Option<i64>, Option<String>) = db
        .conn()
        .query_row(
            "SELECT briefing_id, generated_at, overview FROM briefing_state WHERE key='current'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map(|(a, b, c): (String, i64, Option<String>)| (Some(a), Some(b), c))
        .unwrap_or((None, None, None));
    let engine = llm::pick_engine();
    let rubric_path = rubric::rubric_path()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "(unknown)".into());
    Ok(BriefingStatus {
        current_briefing_id: id,
        generated_at: ts,
        overview,
        engine_available: engine.is_some(),
        engine,
        rubric_path,
    })
}

#[tauri::command]
pub async fn run_briefing(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<briefing_orchestrator::BriefingRunResult, String> {
    use std::sync::atomic::Ordering;
    // In-flight guard: at most one briefing pipeline at a time. Without
    // this two concurrent ↻ clicks (or a double-fire from any source)
    // would write to brief_items with different briefing_ids and race
    // briefing_state writes.
    if state
        .briefing_busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("已有一个简报正在生成中".into());
    }
    let busy = state.briefing_busy.clone();
    let db = state.db.clone();
    // Use a guard struct so we ALWAYS release on early return / panic.
    struct ReleaseGuard(std::sync::Arc<std::sync::atomic::AtomicBool>);
    impl Drop for ReleaseGuard {
        fn drop(&mut self) { self.0.store(false, std::sync::atomic::Ordering::Release); }
    }
    let _guard = ReleaseGuard(busy);
    briefing_orchestrator::run_briefing(app, db).await.map_err(map_err)
}

#[tauri::command]
pub fn list_brief_items(
    state: State<'_, AppState>,
    briefing_id: Option<String>,
) -> Result<Vec<BriefItem>, String> {
    let db = state.db.lock();
    let bid = match briefing_id {
        Some(b) => b,
        None => {
            // Use current.
            db.conn()
                .query_row(
                    "SELECT briefing_id FROM briefing_state WHERE key='current'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_default()
        }
    };
    if bid.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = db
        .conn()
        .prepare(
            "SELECT id, briefing_id, kind, priority, title, summary, why,
                    contact_email, topic_id, related_mail_ids, related_topic_ids,
                    related_event_ids, suggested_actions, status, score,
                    created_at, decided_at
             FROM brief_items
             WHERE briefing_id = ?
             ORDER BY score DESC, created_at ASC",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map(params![bid], |r| {
            let rmids: String = r.get::<_, Option<String>>(9)?.unwrap_or_else(|| "[]".into());
            let rtids: String = r.get::<_, Option<String>>(10)?.unwrap_or_else(|| "[]".into());
            let reids: String = r.get::<_, Option<String>>(11)?.unwrap_or_else(|| "[]".into());
            let actions_json: String = r.get(12)?;
            Ok(BriefItem {
                id: r.get(0)?,
                briefing_id: r.get(1)?,
                kind: r.get(2)?,
                priority: r.get(3)?,
                title: r.get(4)?,
                summary: r.get(5)?,
                why: r.get(6)?,
                contact_email: r.get(7)?,
                topic_id: r.get(8)?,
                related_mail_ids: serde_json::from_str(&rmids).unwrap_or_default(),
                related_topic_ids: serde_json::from_str(&rtids).unwrap_or_default(),
                related_event_ids: serde_json::from_str(&reids).unwrap_or_default(),
                suggested_actions: serde_json::from_str(&actions_json).unwrap_or_default(),
                status: r.get(13)?,
                score: r.get(14)?,
                created_at: r.get(15)?,
                decided_at: r.get(16)?,
            })
        })
        .map_err(map_err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_err)?);
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteStepInput {
    pub item_id: String,
    pub action_index: usize,
    pub step_indices: Option<Vec<usize>>, // null = all steps
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum StepResult {
    Acknowledged { message: String },
    /// Reply stays as a draft — user must review the prose before sending.
    ReplyDrafted {
        draft: String,
        reply_to_mail_id: String,
    },
    /// v0.9.2: calendar steps now AUTO-CREATE the event in Google/Graph
    /// in one click. We extract the structured event via LLM, write it
    /// through to the user's connected account, then return the result
    /// for the FE to toast. Previously this returned EventDrafted and
    /// required a second click on a "✓ 创建到日历" button — users
    /// reported the button being easy to miss, looking like the work
    /// was done when it wasn't.
    EventCreated {
        event_id: String,
        account_email: String,
        title: String,
        start_ms: i64,
        end_ms: i64,
        all_day: bool,
        location: Option<String>,
    },
    /// Same flip for task: auto-create in Google Tasks / Graph Todo.
    TaskCreated {
        task_id: String,
        account_email: String,
        title: String,
        due_ms: Option<i64>,
        notes: Option<String>,
    },
    Skipped { reason: String },
}

#[tauri::command]
pub async fn execute_action_step(
    state: State<'_, AppState>,
    input: ExecuteStepInput,
) -> Result<Vec<StepResult>, String> {
    // Pull the item.
    let item = {
        let db = state.db.lock();
        let row = db
            .conn()
            .query_row(
                "SELECT suggested_actions, related_mail_ids, contact_email, topic_id
                 FROM brief_items WHERE id = ?",
                params![input.item_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .map_err(map_err)?;
        row
    };
    let actions: Vec<SuggestedAction> = serde_json::from_str(&item.0).map_err(map_err)?;
    let related_mail_ids: Vec<String> = serde_json::from_str(&item.1.unwrap_or_else(|| "[]".into()))
        .map_err(map_err)?;
    let action = actions
        .get(input.action_index)
        .ok_or_else(|| format!("action_index out of bounds: {}", input.action_index))?;
    let parent_mail = related_mail_ids.first().cloned();

    // Pick the mail account to write events/tasks into. Preference:
    //   1. The account that received the parent mail (mail_messages.account_id)
    //   2. First mail account on the system
    // If none configured, calendar / task steps are skipped with a clear error.
    let chosen_account: Option<(String, String)> = pick_write_account(&state, parent_mail.as_deref());

    let engine = llm::pick_engine();
    let mut results: Vec<StepResult> = Vec::new();
    let step_indices: Vec<usize> = input
        .step_indices
        .unwrap_or_else(|| (0..action.steps.len()).collect());

    // Reply step always runs last so user has a chance to ack/calendar
    // before opening the writer.
    let mut reply_last: Option<usize> = None;
    let mut order: Vec<usize> = Vec::new();
    for i in step_indices.iter().copied() {
        if let Some(s) = action.steps.get(i) {
            if s.kind == "reply" {
                reply_last = Some(i);
            } else {
                order.push(i);
            }
        }
    }
    if let Some(i) = reply_last {
        order.push(i);
    }

    for i in order {
        let step = match action.steps.get(i) {
            Some(s) => s,
            None => continue,
        };
        match step.kind.as_str() {
            "acknowledge" => {
                // Special-case: detail = "open_topic:<topic_id>" means the
                // FE should route to that topic.
                if let Some(rest) = step.detail.strip_prefix("open_topic:") {
                    results.push(StepResult::Acknowledged {
                        message: format!("open_topic:{}", rest),
                    });
                } else {
                    results.push(StepResult::Acknowledged {
                        message: "ack".into(),
                    });
                }
            }
            "calendar" => {
                let eng = match engine.as_deref() {
                    Some(e) => e,
                    None => {
                        results.push(StepResult::Skipped {
                            reason: "未检测到已登录的 Claude/Codex CLI".into(),
                        });
                        continue;
                    }
                };
                let (acct_id, acct_email) = match chosen_account.clone() {
                    Some(a) => a,
                    None => {
                        results.push(StepResult::Skipped {
                            reason: "未配置邮箱账号，无法写入日历".into(),
                        });
                        continue;
                    }
                };
                // Step 1: extract structured event via LLM.
                let context_text = if let Some(mid) = parent_mail.as_deref() {
                    let db = state.db.lock();
                    event_extractor::load_mail_context(&db, mid).unwrap_or_default()
                } else {
                    String::new()
                };
                let extracted = match event_extractor::extract(eng, &step.detail, &context_text).await {
                    Ok(e) => e,
                    Err(err) => {
                        results.push(StepResult::Skipped {
                            reason: format!("calendar 提取失败: {}", err),
                        });
                        continue;
                    }
                };
                // Step 2: actually create in Google/Graph. AUTO — no second
                // user click. Previously v0.9.1 only drafted here and users
                // missed the second confirm button.
                let cfg = state.oauth_cfg.clone();
                let db = state.db.clone();
                let create_input = crate::calendar::CreateEventInput {
                    account_id: acct_id.clone(),
                    title: extracted.title.clone(),
                    start_ms: extracted.start_ms,
                    end_ms: extracted.end_ms,
                    all_day: extracted.all_day,
                    location: extracted.location.clone(),
                };
                match crate::calendar::create_event_remote(&cfg, db, create_input).await {
                    Ok(ev) => {
                        // Creation is server-first, but immediately pull the
                        // calendar window back down so the Calendar view is
                        // consistent even when it started from an empty cache.
                        if let Err(sync_err) = crate::calendar::sync_account_calendar(&cfg, state.db.clone(), &acct_id).await {
                            eprintln!("[salmon][briefing] calendar post-create sync failed: {}", sync_err);
                        }
                        results.push(StepResult::EventCreated {
                            event_id: ev.id,
                            account_email: acct_email,
                            title: extracted.title,
                            start_ms: extracted.start_ms,
                            end_ms: extracted.end_ms,
                            all_day: extracted.all_day,
                            location: extracted.location,
                        });
                    }
                    Err(err) => results.push(StepResult::Skipped {
                        reason: format!("写入日历失败: {}", err),
                    }),
                }
            }
            "task" => {
                let (acct_id, acct_email) = match chosen_account.clone() {
                    Some(a) => a,
                    None => {
                        results.push(StepResult::Skipped {
                            reason: "未配置邮箱账号，无法写入待办".into(),
                        });
                        continue;
                    }
                };
                let context_text = if let Some(mid) = parent_mail.as_deref() {
                    let db = state.db.lock();
                    event_extractor::load_mail_context(&db, mid).unwrap_or_default()
                } else {
                    String::new()
                };
                let extracted = if let Some(eng) = engine.as_deref() {
                    crate::task_extractor::extract(eng, &step.detail, &context_text).await
                        .unwrap_or_else(|_| crate::task_extractor::ExtractedTask {
                            title: step.detail.clone(),
                            due_ms: None,
                            notes: None,
                        })
                } else {
                    crate::task_extractor::ExtractedTask {
                        title: step.detail.clone(),
                        due_ms: None,
                        notes: None,
                    }
                };
                let cfg = state.oauth_cfg.clone();
                let db = state.db.clone();
                let create_input = crate::tasks::CreateTaskInput {
                    account_id: acct_id.clone(),
                    title: extracted.title.clone(),
                    notes: extracted.notes.clone(),
                    due_ms: extracted.due_ms,
                    source_kind: Some("briefing".into()),
                    source_brief_item_id: Some(input.item_id.clone()),
                };
                match crate::tasks::create_task_remote(&cfg, db, create_input).await {
                    Ok(t) => results.push(StepResult::TaskCreated {
                        task_id: t.id,
                        account_email: acct_email,
                        title: extracted.title,
                        due_ms: extracted.due_ms,
                        notes: extracted.notes,
                    }),
                    Err(err) => {
                        // Common case: existing OAuth account predates the
                        // tasks scope. Be specific so the user knows to re-login.
                        let s = err.to_string();
                        let reason = if s.contains("403") || s.contains("insufficient")
                            || s.contains("ACCESS_TOKEN_SCOPE") || s.contains("scope")
                        {
                            "需要重新登录此账号以授权 tasks 权限".into()
                        } else {
                            format!("写入待办失败: {}", err)
                        };
                        results.push(StepResult::Skipped { reason });
                    }
                }
            }
            "reply" => {
                let eng = match engine.as_deref() {
                    Some(e) => e,
                    None => {
                        results.push(StepResult::Skipped {
                            reason: "no LLM engine for reply".into(),
                        });
                        continue;
                    }
                };
                let parent_id = match parent_mail.as_deref() {
                    Some(p) => p.to_string(),
                    None => {
                        results.push(StepResult::Skipped {
                            reason: "no parent mail to reply to".into(),
                        });
                        continue;
                    }
                };
                // Gather context under brief lock, then drop BEFORE await.
                let ctx = {
                    let db = state.db.lock();
                    writer::gather_reply_context(&db, &parent_id)
                };
                let ctx = match ctx {
                    Ok(c) => c,
                    Err(e) => {
                        results.push(StepResult::Skipped {
                            reason: format!("writer ctx: {}", e),
                        });
                        continue;
                    }
                };
                let res = writer::draft_reply(eng, &ctx, &step.detail).await;
                match res {
                    Ok(draft) => results.push(StepResult::ReplyDrafted {
                        draft,
                        reply_to_mail_id: parent_id,
                    }),
                    Err(e) => results.push(StepResult::Skipped {
                        reason: format!("writer: {}", e),
                    }),
                }
            }
            _ => results.push(StepResult::Skipped {
                reason: format!("unknown step kind: {}", step.kind),
            }),
        }
    }

    // Log feedback + maybe mark item acted-on. Don't mark acted if every
    // step Skipped — the user should be able to retry. They'll see the
    // skipped reasons in toasts and can fix (e.g. add a mail account,
    // re-login for tasks scope, etc) and click the same action again.
    let any_succeeded = results.iter().any(|r| !matches!(r, StepResult::Skipped { .. }));
    {
        let db = state.db.lock();
        db.conn()
            .execute(
                "INSERT INTO feedback_log(ts, kind, item_id, item_title, detail)
                 SELECT ?, ?, id, title, ? FROM brief_items WHERE id = ?",
                params![
                    chrono::Utc::now().timestamp_millis(),
                    if any_succeeded { "act" } else { "act_failed" },
                    action.label,
                    input.item_id,
                ],
            )
            .map_err(map_err)?;
        if any_succeeded {
            db.conn()
                .execute(
                    "UPDATE brief_items SET status='acted', decided_at=? WHERE id=?",
                    params![chrono::Utc::now().timestamp_millis(), input.item_id],
                )
                .map_err(map_err)?;
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn decide_brief_item(
    state: State<'_, AppState>,
    item_id: String,
    status: String,
) -> Result<(), String> {
    if !matches!(status.as_str(), "acted" | "ack" | "muted" | "pending") {
        return Err(format!("invalid status: {}", status));
    }
    let db = state.db.lock();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let decided_at = if status == "pending" { None } else { Some(now_ms) };
    db.conn()
        .execute(
            "UPDATE brief_items SET status=?, decided_at=? WHERE id=?",
            params![status, decided_at, item_id],
        )
        .map_err(map_err)?;
    db.conn()
        .execute(
            "INSERT INTO feedback_log(ts, kind, item_id, item_title, detail)
             SELECT ?, ?, id, title, NULL FROM brief_items WHERE id = ?",
            params![now_ms, status, item_id],
        )
        .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn get_rubric() -> Result<String, String> {
    rubric::load().map_err(map_err)
}

#[tauri::command]
pub fn set_rubric(content: String) -> Result<(), String> {
    rubric::save(&content).map_err(map_err)
}

#[tauri::command]
pub async fn maybe_edit_rubric(state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.clone();
    briefing_orchestrator::maybe_edit_rubric(db).await.map_err(map_err)
}

/// Pick which mail account to write a new calendar event / task into.
/// Preference: (1) account that received the parent mail, so a school
/// invite that came to gmail-A creates the event in gmail-A's calendar;
/// (2) the first configured mail account.
/// Returns (account_id, account_email) or None if no accounts.
fn pick_write_account(
    state: &State<'_, AppState>,
    parent_mail_id: Option<&str>,
) -> Option<(String, String)> {
    let db = state.db.lock();
    // Try (1) via parent mail's account.
    if let Some(mid) = parent_mail_id {
        if let Ok((acct_id, email)) = db.conn().query_row(
            "SELECT a.id, a.email FROM mail_messages m
             JOIN mail_accounts a ON a.id = m.account_id
             WHERE m.id = ?",
            params![mid],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ) {
            return Some((acct_id, email));
        }
    }
    // Fallback: first mail account.
    db.conn()
        .query_row(
            "SELECT id, email FROM mail_accounts ORDER BY added_at ASC LIMIT 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .ok()
}
