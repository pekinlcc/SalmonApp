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
    <div className="three-pane">
      <aside className="three-list">
        <div className="left-head">
          <div className="logo">✦</div>
          <div className="name">今日聚焦</div>
          {status?.generatedAt && (
            <div className="ver">{relativeTime(status.generatedAt)}</div>
          )}
        </div>
        <Banner status={status} progress={progress} running={running} onRefresh={onRefresh} />
        {error && <div className="briefing-error" style={{ margin: "0 12px 8px" }}>⚠ {error}</div>}
        <div className="topic-list">
          {items.length === 0 && !running ? (
            <div style={{ padding: "30px 18px", fontSize: 12, color: "var(--ink-500)", textAlign: "center" }}>
              {status?.engineAvailable
                ? "暂无待办 · 点 ↻ 让 AI 重新评估"
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

// ── Banner inside list pane ───────────────────────────────────────────

function Banner({ status, progress, running, onRefresh }: {
  status: BriefingStatus | null;
  progress: BriefingProgress | null;
  running: boolean;
  onRefresh: () => Promise<void> | void;
}) {
  const stage = progress?.stage;
  const note = useMemo(() => {
    if (!running) return null;
    if (!stage || stage === "starting") return "启动中…";
    if (stage === "roost") return "聚合联系人…";
    if (stage === "pulse") return `分析 ${progress?.current}/${progress?.total}…`;
    if (stage === "briefing") return "全局排序…";
    if (stage === "cross-link") return "查跨域关联…";
    return stage;
  }, [running, stage, progress]);

  return (
    <div className="briefing-banner" style={{ margin: "0 12px 10px" }}>
      <span className={`banner-dot ${status?.engineAvailable ? "ok" : "off"}`} />
      <div className="banner-text">
        {running ? <b>评估中… {note}</b> : status?.overview ? <span>{status.overview}</span>
          : status?.engineAvailable ? <span>点 ↻ 让 AI 开始评估</span>
          : <span style={{ color: "#B7493D" }}>未检测到 CLI</span>}
      </div>
      <button className="banner-refresh" disabled={running} onClick={() => onRefresh()}>
        {running ? "…" : "↻"}
      </button>
    </div>
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
