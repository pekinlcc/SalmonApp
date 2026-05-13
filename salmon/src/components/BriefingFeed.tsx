import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  BriefItem,
  BriefingProgress,
  BriefingStatus,
  Recommendation,
  StepResult,
  Topic,
  UsageSummary,
} from "../lib/types";
import { relativeTime } from "../lib/format";
import { RelatedMailList } from "./RelatedMailList";

interface Props {
  topics: Topic[];
  onOpenTopic: (id: string) => void;
  /** v0.9.1: running state lives in App.tsx so it survives navigation. */
  running: boolean;
  progress: BriefingProgress | null;
  /** Bumped by App.tsx when stage='done' arrives. */
  tick: number;
  onRefresh: () => Promise<void> | void;
  /** v0.11.1: when no brief item is selected, the detail pane shows a
   *  welcome panel with usage summary + recent topics + attention rows.
   *  These props feed that panel. */
  usageSummary: UsageSummary | null;
  recentTopics: Topic[];
  attentionTopics: { topic: Topic; reason: string }[];
  recommendations: Recommendation[];
  onNewTopic: () => void;
  /** v1.3: top-overview-bar stat — unread mail count (App.tsx already tracks
   *  this for the IconRail badge; piped through so the stat row is live). */
  unreadMail: number;
}

/**
 * v0.11.1 — BriefingFeed turned into a 3-pane view (matches the
 * app-shell pattern from the v0.11 mockup): brief items live in the
 * left list pane, the selected item's full card + suggestedActions
 * lives in the right detail pane. With nothing selected the detail
 * pane shows a "Welcome back" overview (usage, recent topics, attention).
 */
export function BriefingFeed(props: Props) {
  const { topics, onOpenTopic, running, progress, tick, onRefresh } = props;
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const [items, setItems] = useState<BriefItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, StepResult[]>>({});

  const refreshAll = useCallback(async () => {
    try {
      const s = await api.getBriefingStatus();
      setStatus(s);
      const all = await api.listBriefItems(null);
      const pending = all.filter((x) => x.status === "pending");
      setItems(pending);
      // Keep selected if still present, else pick first.
      setSelectedId((cur) => {
        if (cur && pending.find((x) => x.id === cur)) return cur;
        return pending[0]?.id ?? null;
      });
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { refreshAll(); }, [refreshAll, tick]);

  const selected = useMemo(
    () => items.find((x) => x.id === selectedId) || null,
    [items, selectedId]
  );

  return (
    <div className="brief-shell">
      <BriefOverviewBar
        status={status}
        items={items}
        topics={topics}
        unreadMail={props.unreadMail}
        running={running}
        progress={progress}
        onRefresh={onRefresh}
      />
      {error && <div className="briefing-error" style={{ margin: "8px 22px" }}>⚠ {error}</div>}
      <div className="three-pane brief-three">
        <aside className="three-list">
          <div className="topic-list" style={{ paddingTop: 8 }}>
            {items.length === 0 && !running ? (
              <div style={{ padding: "30px 18px", fontSize: 12, color: "var(--ink-500)", textAlign: "center" }}>
                {status?.engineAvailable
                  ? "暂无待办 · 点上方 ↻ 让 AI 重新评估"
                  : "未检测到已登录的 Claude/Codex CLI"}
              </div>
            ) : (
              items.map((it) => (
                <BriefListRow
                  key={it.id}
                  item={it}
                  active={it.id === selectedId}
                  onClick={() => setSelectedId(it.id)}
                />
              ))
            )}
          </div>
        </aside>

        <section className="three-detail">
        {selected ? (
          <BriefDetail
            item={selected}
            topics={topics}
            draft={drafts[selected.id]}
            onAction={async (actionIndex) => {
              try {
                const results = await api.executeActionStep({
                  itemId: selected.id,
                  actionIndex,
                  stepIndices: null,
                });
                setDrafts((cur) => ({ ...cur, [selected.id]: results }));

                for (const r of results) {
                  let msg = ""; let kind: "done" | "info" | "error" = "info";
                  if (r.kind === "Acknowledged") {
                    msg = r.message.startsWith("open_topic:") ? "前往 Topic" : "✓ 已确认";
                    kind = "done";
                  } else if (r.kind === "EventCreated") {
                    const when = r.allDay
                      ? new Date(r.startMs).toLocaleDateString("zh-CN")
                      : new Date(r.startMs).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "numeric", day: "numeric" });
                    msg = `✓ 已加日历: ${r.title} (${when})`; kind = "done";
                  } else if (r.kind === "TaskCreated") {
                    const when = r.dueMs ? ` · 截止 ${new Date(r.dueMs).toLocaleDateString("zh-CN")}` : "";
                    msg = `✓ 已加待办: ${r.title}${when}`; kind = "done";
                  } else if (r.kind === "ReplyDrafted") {
                    msg = "💬 回信草稿已生成 · 看下面审稿"; kind = "info";
                  } else if (r.kind === "Skipped") {
                    msg = `⚠ 跳过: ${r.reason}`; kind = "error";
                  }
                  window.dispatchEvent(new CustomEvent("salmon:toast", { detail: { title: msg, kind } }));
                }

                const hasInteractive = results.some((r) => r.kind === "ReplyDrafted");
                const anySuccess = results.some((r) => r.kind !== "Skipped");
                if (!hasInteractive && anySuccess) {
                  // Card consumed — remove from list and clear selection
                  setItems((cur) => cur.filter((x) => x.id !== selected.id));
                  setSelectedId(null);
                  for (const r of results) {
                    if (r.kind === "Acknowledged" && r.message.startsWith("open_topic:")) {
                      const id = r.message.slice("open_topic:".length);
                      if (id) onOpenTopic(id);
                    }
                  }
                }
              } catch (e: any) {
                window.dispatchEvent(new CustomEvent("salmon:toast", {
                  detail: { title: `执行失败: ${e}`, kind: "error" },
                }));
              }
            }}
            onDismiss={async () => {
              try {
                await api.decideBriefItem(selected.id, "muted");
                setItems((cur) => cur.filter((x) => x.id !== selected.id));
                setSelectedId(null);
                window.dispatchEvent(new CustomEvent("salmon:toast", {
                  detail: { title: "✓ 已压制此条目", kind: "done" },
                }));
              } catch (e: any) {
                window.dispatchEvent(new CustomEvent("salmon:toast", {
                  detail: { title: `操作失败: ${e}`, kind: "error" },
                }));
              }
            }}
            onClearDraft={() => setDrafts((cur) => {
              const next = { ...cur };
              delete next[selected.id];
              return next;
            })}
          />
        ) : (
          <HomeOverview
            usage={props.usageSummary}
            recent={props.recentTopics}
            attention={props.attentionTopics}
            onOpenTopic={onOpenTopic}
            onNewTopic={props.onNewTopic}
          />
        )}
        </section>

        <aside className="brief-right-pane">
          <BriefAiActivity status={status} running={running} progress={progress} items={items} />
        </aside>
      </div>
    </div>
  );
}

// ── List row (compact style; uses .topic class from current sidebar) ─

function BriefListRow({ item, active, onClick }: { item: BriefItem; active: boolean; onClick: () => void }) {
  const prioCls = item.priority === "high" ? "prio-high" : item.priority === "low" ? "prio-low" : "prio-medium";
  const prioLabel = item.priority === "high" ? "高" : item.priority === "low" ? "低" : "中";
  const icon = item.kind === "cross" ? "🔗" : item.kind === "topic" ? "💬" : item.kind === "event" ? "📅" : "📧";
  const pillBg = item.kind === "cross" ? "#D8F0DD" : item.kind === "topic" ? "#ECE0FB" : item.kind === "event" ? "#E6F0FF" : "#FFE4DA";
  const pillFg = item.kind === "cross" ? "#266B33" : item.kind === "topic" ? "#6F44B4" : item.kind === "event" ? "#2F5BB7" : "#B7493D";
  return (
    <div className={`topic ${active ? "active" : ""}`} onClick={onClick} style={{ cursor: "pointer" }}>
      <div className="t-row">
        <span
          className="engine-pill"
          style={{ background: pillBg, color: pillFg }}
        >{icon}</span>
        <span className="t-title">{item.title}</span>
        <span className={`prio-pill ${prioCls}`}>{prioLabel}</span>
      </div>
      <div className="t-meta">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
          {item.contactEmail || (item.kind === "topic" ? "(Topic)" : "")}
        </span>
        <span>{relativeTime(item.createdAt)}</span>
      </div>
    </div>
  );
}

// ── Detail pane (selected brief item) ────────────────────────────────

function BriefDetail({
  item,
  topics,
  draft,
  onAction,
  onDismiss,
  onClearDraft,
}: {
  item: BriefItem;
  topics: Topic[];
  draft: StepResult[] | undefined;
  onAction: (actionIndex: number) => Promise<void>;
  onDismiss: () => void;
  onClearDraft: () => void;
}) {
  const [busyAction, setBusyAction] = useState<number | null>(null);
  const click = useCallback(
    async (i: number) => {
      setBusyAction(i);
      try { await onAction(i); }
      finally { setBusyAction(null); }
    },
    [onAction]
  );
  const topicTitle = item.topicId ? topics.find((t) => t.id === item.topicId)?.title : undefined;

  return (
    <>
      <div className="mid-head">
        <div className="title">{item.title}</div>
        <button className="btn-ghost" onClick={onDismiss} style={{ color: "#B7493D" }}>不重要</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {item.summary && (
          <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-700)", marginTop: 0 }}>
            {item.summary}
          </p>
        )}
        {item.why && (
          <div className="brief-why" style={{ marginBottom: 14 }}>
            <span className="brief-why-label">↗ AI 解释：</span>
            {item.why}
          </div>
        )}

        <div className="three-section-label" style={{ padding: "0 0 8px" }}>建议你怎么处理</div>
        <div className="brief-actions" style={{ marginBottom: 16 }}>
          {item.suggestedActions.map((a, i) => {
            const stepCount = a.steps.length;
            const isPrimary = i === 0;
            const isBusy = busyAction === i;
            return (
              <button
                key={i}
                className={`brief-btn ${isPrimary ? "primary" : ""}`}
                disabled={busyAction !== null}
                onClick={() => click(i)}
                title={a.steps.map((s) => `${s.kind}: ${s.detail || "(空)"}`).join("\n")}
              >
                {isBusy ? "执行中…" : a.label}
                {stepCount > 1 && <span className="brief-gear">⚙ {stepCount}</span>}
              </button>
            );
          })}
        </div>

        <div className="three-section-label" style={{ padding: "0 0 4px" }}>相关</div>
        {item.contactEmail && (
          <div className="info-row-inline"><b>联系人：</b>{item.contactEmail}</div>
        )}
        {topicTitle && (
          <div className="info-row-inline"><b>Topic：</b>{topicTitle}</div>
        )}
        {item.relatedMailIds.length > 0 && (
          <div className="info-row-inline">
            <RelatedMailList mailIds={item.relatedMailIds} />
          </div>
        )}

        {draft && draft.length > 0 && (
          <DraftPanel results={draft} onClose={onClearDraft} />
        )}
      </div>
    </>
  );
}

// ── DraftPanel — only ReplyDrafted needs an inline review (v0.9.2) ───

function DraftPanel({
  results,
  onClose,
}: {
  results: StepResult[];
  onClose: () => void;
}) {
  return (
    <div className="brief-drafts" style={{ marginTop: 16 }}>
      <div className="brief-drafts-head">
        <span>AI 执行结果</span>
        <button className="btn-ghost" onClick={onClose}>×</button>
      </div>
      {results.map((r, i) => {
        if (r.kind === "ReplyDrafted") {
          return (
            <div key={i} className="draft-reply">
              <div className="draft-label">💬 回信草稿（你审核后手动发）</div>
              <pre className="draft-body">{r.draft}</pre>
              <div className="draft-actions">
                <button
                  className="brief-btn primary"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("salmon:open-compose-reply", {
                      detail: { replyToMailId: r.replyToMailId, bodyText: r.draft },
                    }));
                  }}
                >
                  在邮件撰写窗口打开
                </button>
                <button
                  className="brief-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(r.draft).catch(() => {});
                    window.dispatchEvent(new CustomEvent("salmon:toast", {
                      detail: { title: "✓ 已复制到剪贴板", kind: "done" },
                    }));
                  }}
                >
                  复制
                </button>
              </div>
            </div>
          );
        }
        if (r.kind === "Skipped") {
          return (
            <div key={i} className="draft-skipped">⚠ 跳过一步: {r.reason}</div>
          );
        }
        return null;
      })}
    </div>
  );
}

// ── v1.3 top overview banner (spans the whole content area) ──────────

function progressNote(running: boolean, progress: BriefingProgress | null): string | null {
  if (!running) return null;
  const stage = progress?.stage;
  if (!stage || stage === "starting") return "启动中…";
  if (stage === "roost") return "聚合联系人邮件…";
  if (stage === "pulse") return `分析联系人 ${progress?.current}/${progress?.total}…`;
  if (stage === "briefing") return "全局排序与去重…";
  if (stage === "cross-link") return "查 Topic ↔ Mail 跨域关联…";
  return stage;
}

function BriefOverviewBar({
  status,
  items,
  topics,
  unreadMail,
  running,
  progress,
  onRefresh,
}: {
  status: BriefingStatus | null;
  items: BriefItem[];
  topics: Topic[];
  unreadMail: number;
  running: boolean;
  progress: BriefingProgress | null;
  onRefresh: () => Promise<void> | void;
}) {
  const high = items.filter((i) => i.priority === "high").length;
  const midLow = items.filter((i) => i.priority !== "high").length;
  const activeTopics = topics.filter((t) => !t.archived).length;
  const note = progressNote(running, progress);

  const overview = (() => {
    if (running) return <b>评估中… {note}</b>;
    if (status?.overview) return status.overview;
    if (status && !status.engineAvailable) {
      return <span style={{ color: "#B7493D" }}>未检测到已登录的 Claude / Codex CLI</span>;
    }
    if (items.length === 0) return "暂无待处理事项 — 点右侧「刷新」让 AI 重新评估今天的邮件 / Topic。";
    return `共 ${items.length} 件待处理${high > 0 ? `，其中 ${high} 件高优先` : ""}。`;
  })();

  return (
    <div className="brief-overview-bar">
      <div className="brief-ov-left">
        <div className="brief-ov-head">
          <span className={`brief-pulse-dot ${running ? "live" : ""}`} />
          <span>今日总览</span>
          {status?.generatedAt && !running && (
            <span className="brief-ov-age">· 刚刚更新于 {relativeTime(status.generatedAt)}</span>
          )}
        </div>
        <div className="brief-ov-text">{overview}</div>
      </div>
      <div className="brief-ov-stats">
        <div className="brief-stat"><div className="brief-stat-n salmon">{high}</div><div className="brief-stat-l">高优先</div></div>
        <div className="brief-stat"><div className="brief-stat-n">{midLow}</div><div className="brief-stat-l">中 / 低</div></div>
        <div className="brief-stat"><div className="brief-stat-n">{unreadMail}</div><div className="brief-stat-l">未读邮件</div></div>
        <div className="brief-stat"><div className="brief-stat-n">{activeTopics}</div><div className="brief-stat-l">活跃 Topic</div></div>
      </div>
      <div className="brief-ov-right">
        <button
          className={`brief-refresh-btn ${running ? "busy" : ""}`}
          onClick={() => !running && onRefresh()}
          disabled={running}
          title={running ? "评估流水线运行中" : "重新跑 Briefing"}
        >
          {running ? <span className="brief-spinner" aria-hidden="true" /> : <span aria-hidden="true">↻</span>}
          <span>{running ? "评估中…" : "刷新"}</span>
        </button>
      </div>
    </div>
  );
}

// ── v1.3 right pane: live "what AI just did" timeline ───────────────

function BriefAiActivity({
  status,
  running,
  progress,
  items,
}: {
  status: BriefingStatus | null;
  running: boolean;
  progress: BriefingProgress | null;
  items: BriefItem[];
}) {
  // Tiny timeline. While running, top entry is the current pipeline
  // stage (pulses + updates as the orchestrator emits progress events).
  // Otherwise the top entry is the last completed Briefing run with its
  // item count. No persisted history — that'd need a new table; v1.3
  // keeps it cheap and entirely derivable from existing state.
  const note = progressNote(running, progress);
  const high = items.filter((i) => i.priority === "high").length;

  return (
    <>
      <div className="brief-right-head">
        <span className={`brief-pulse-dot ${running ? "live" : ""}`} />
        <span>AI 活动</span>
      </div>
      <div className="brief-ai-tl">
        {running && (
          <div className="brief-ai-row">
            <span className="brief-ai-dot live" />
            <div className="brief-ai-body">
              <div className="brief-ai-when">现在</div>
              <div className="brief-ai-what">{note || "正在评估…"}</div>
            </div>
          </div>
        )}
        {status?.generatedAt && !running && (
          <div className="brief-ai-row">
            <span className="brief-ai-dot done" />
            <div className="brief-ai-body">
              <div className="brief-ai-when">{relativeTime(status.generatedAt)}</div>
              <div className="brief-ai-what">
                Briefing 跑完 · {items.length} 件待处理
                {high > 0 ? ` (${high} 高)` : ""}
              </div>
            </div>
          </div>
        )}
        {!status?.generatedAt && !running && (
          <div style={{ padding: "12px 4px", fontSize: 12, color: "var(--ink-500)" }}>
            尚未运行 Briefing。
          </div>
        )}
      </div>

      <div className="brief-right-head" style={{ marginTop: 18 }}>
        <span>引擎状态</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-700)", lineHeight: 1.7 }}>
        <div>
          <span
            className="brief-engine-dot"
            style={{ background: status?.engineAvailable ? "#5AA76C" : "#B7493D" }}
            aria-hidden="true"
          />
          {status?.engineAvailable ? "LLM 引擎在线" : "LLM 引擎不可用"}
        </div>
        {status?.engine && (
          <div style={{ color: "var(--ink-500)" }}>
            上次使用：{status.engine === "claude" ? "Claude Code" : status.engine === "codex" ? "Codex" : status.engine}
          </div>
        )}
      </div>
    </>
  );
}

// ── Fallback overview (when nothing selected) ────────────────────────

function HomeOverview({
  usage,
  recent,
  attention,
  onOpenTopic,
  onNewTopic,
}: {
  usage: UsageSummary | null;
  recent: Topic[];
  attention: { topic: Topic; reason: string }[];
  onOpenTopic: (id: string) => void;
  onNewTopic: () => void;
}) {
  return (
    <>
      <div className="mid-head">
        <div className="title"><span className="welcome-spark">✦</span> 欢迎回来</div>
        <button className="btn-ghost" onClick={onNewTopic}>＋ 新建 Topic</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        <p style={{ color: "var(--ink-500)", fontSize: 13, marginTop: 0 }}>
          左侧是 AI 整理的今日待办。点任一条进入详情。
          没有事项时这里显示用量和最近 Topic。
        </p>

        {attention.length > 0 && (
          <>
            <div className="three-section-label" style={{ padding: "0 0 6px" }}>需要处理 · 系统状态</div>
            {attention.slice(0, 5).map((r) => (
              <div
                key={r.topic.id}
                className="topic"
                onClick={() => onOpenTopic(r.topic.id)}
                style={{ cursor: "pointer", margin: "1px 0" }}
              >
                <div className="t-row">
                  <span className={`engine-pill ${r.topic.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                    {r.topic.engine === "claude" ? "CC" : "CX"}
                  </span>
                  <span className="t-title">{r.topic.title || "(未命名)"}</span>
                  <span style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 4, background: "#FFE5DA", color: "#B7493D" }}>
                    {r.reason}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}

        {recent.length > 0 && (
          <>
            <div className="three-section-label" style={{ padding: "12px 0 6px" }}>最近 Topic</div>
            {recent.slice(0, 5).map((t) => (
              <div
                key={t.id}
                className="topic"
                onClick={() => onOpenTopic(t.id)}
                style={{ cursor: "pointer", margin: "1px 0" }}
              >
                <div className="t-row">
                  <span className={`engine-pill ${t.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                    {t.engine === "claude" ? "CC" : "CX"}
                  </span>
                  <span className="t-title">{t.title || "(未命名)"}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-500)" }}>{relativeTime(t.updatedAt)}</span>
                </div>
              </div>
            ))}
          </>
        )}

        {usage && (usage.todayIn + usage.todayOut + usage.totalIn + usage.totalOut) > 0 && (
          <>
            <div className="three-section-label" style={{ padding: "12px 0 6px" }}>用量</div>
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--ink-700)" }}>
              <span>今日 {compactTokens(usage.todayIn + usage.todayOut)}</span>
              <span>7 天 {compactTokens(usage.weekIn + usage.weekOut)}</span>
              <span>30 天 {compactTokens(usage.monthIn + usage.monthOut)}</span>
              <span>累计 {compactTokens(usage.totalIn + usage.totalOut)}</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function compactTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
