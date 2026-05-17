//! Briefing — second-pass LLM call that takes the union of per-contact
//! Pulse items, dedups across contacts (e.g. an event invite that both
//! organizer and attendee discussed), re-ranks globally, and emits a
//! short user-facing overview line.
//!
//! Skipping this stage and just concatenating Pulse outputs is the
//! degradation path when LLM is unavailable.

use crate::llm::{call_llm, extract_json_object};
use crate::pulse::PulseItem;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalBriefing {
    pub overview: String,
    pub ordered_indices: Vec<usize>, // indices into the input Vec<PulseItem>
    pub merge_groups: Vec<Vec<usize>>, // groups of indices to merge into one card
}

/// `inputs` carries (contact_email, contact_name, item) so the model can
/// reason about cross-contact context. The model returns indices into the
/// flattened list.
pub async fn rank_and_dedup(
    engine: &str,
    rubric: &str,
    inputs: &[(String, Option<String>, PulseItem)],
) -> Result<GlobalBriefing> {
    if inputs.is_empty() {
        return Ok(GlobalBriefing {
            overview: "暂无需要现在处理的事项".into(),
            ordered_indices: Vec::new(),
            merge_groups: Vec::new(),
        });
    }
    let prompt = build_prompt(inputs);
    let system = build_system(rubric);
    let raw = call_llm(engine, &system, &prompt).await?;
    parse(&raw, inputs.len())
}

fn build_system(rubric: &str) -> String {
    format!(
        "你是 SalmonApp 的简报汇总助手。任务是把按联系人产出的多张事项卡再做一次全局梳理：\
         去重 / 合并 / 排序，并写一句概览。\n\n\
         【硬规则】\n\
         - 不发明新事项；只在给定 items 之间做选择 + 合并。\n\
         - 高优先级永远排在中 / 低之前；同级按时间紧迫性。\n\
         - 合并条件（mergeGroups）：同一个事件 / 同一封 thread 在多个联系人卡里出现，或\
         两张卡的 title 描述同一件事。合并后第一个 index 是代表。\n\
         - overview 一句中文，≤60 字，指明谁/什么事/为什么紧。\n\n\
         【输出格式 - 严格 JSON】\n\
         {{\n  \"overview\": \"...\",\n  \"orderedIndices\": [0, 3, 1, ...],\n  \
         \"mergeGroups\": [[1, 4], [2, 5, 7]]\n}}\n\n\
         【用户的 Rubric】\n{}\n",
        rubric
    )
}

fn build_prompt(inputs: &[(String, Option<String>, PulseItem)]) -> String {
    let mut s = String::new();
    s.push_str("【待汇总的 items】\n");
    for (i, (email, name, it)) in inputs.iter().enumerate() {
        let owner = name.as_deref().unwrap_or(email);
        s.push_str(&format!(
            "[idx={}] [{}] [{}] {}\n  why: {}\n",
            i, it.priority, owner, it.title, it.why,
        ));
    }
    s
}

fn parse(raw: &str, n: usize) -> Result<GlobalBriefing> {
    let body = extract_json_object(raw)
        .ok_or_else(|| anyhow!("Briefing: 无 JSON"))?;
    let v: serde_json::Value = serde_json::from_str(&body).context("Briefing parse")?;
    let overview = v
        .get("overview")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let ordered_indices: Vec<usize> = v
        .get("orderedIndices")
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_u64().map(|n| n as usize)).collect())
        .unwrap_or_default();
    let merge_groups: Vec<Vec<usize>> = v
        .get("mergeGroups")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|g| {
                    g.as_array().map(|inner| {
                        inner
                            .iter()
                            .filter_map(|x| x.as_u64().map(|n| n as usize))
                            .filter(|i| *i < n)
                            .collect::<Vec<usize>>()
                    })
                })
                .filter(|g| g.len() >= 2)
                .collect()
        })
        .unwrap_or_default();

    // Filter ordered_indices to valid range. If the model dropped some,
    // append the missing ones in original order to avoid silently losing
    // events.
    let mut seen = std::collections::HashSet::new();
    let mut final_order: Vec<usize> = Vec::new();
    for idx in ordered_indices {
        if idx < n && seen.insert(idx) {
            final_order.push(idx);
        }
    }
    for i in 0..n {
        if seen.insert(i) {
            final_order.push(i);
        }
    }

    Ok(GlobalBriefing {
        overview,
        ordered_indices: final_order,
        merge_groups,
    })
}
