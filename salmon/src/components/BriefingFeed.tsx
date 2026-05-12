import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  BriefItem,
  BriefingProgress,
  BriefingStatus,
  StepResult,
  Topic,
} from "../lib/types";

interface Props {
  topics: Topic[];
  onOpenTopic: (id: string) => void;
  /** v0.9.1: running state lives in App.tsx so it survives navigating
   *  between home and a Topic view (this component unmounts but the
   *  backend pipeline keeps running — without lifted state the "AI 正在
   *  评估…" banner would disappear). */
  running: boolean;
  progress: BriefingProgress | null;
  /** Bumped by App.tsx when a salmon-briefing-progress stage='done'
   *  arrives — BriefingFeed re-reads brief_items on tick change. */
  tick: number;
  onRefresh: () => Promise<void> | void;
}

/**
 * v0.9.1 — single mixed feed driven by the LLM agent pipeline. Renders
 * BriefItems with their per-card suggestedActions; cross-link cards show
 * combined mail + topic context.
 */
export function BriefingFeed({ topics, onOpenTopic, running, progress, tick, onRefresh }: Props) {
  const [status, setStatus] = useState<BriefingStatus | null>(null);
  const [items, setItems] = useState<BriefItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeDrafts, setActiveDrafts] = useState<Record<string, StepResult[]>>({});

  const refreshAll = useCallback(async () => {
    try {
      const s = await api.getBriefingStatus();
      setStatus(s);
      const i = await api.listBriefItems(null);
      setItems(i.filter((x) => x.status === "pending"));
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  // Initial load + reload on `done` event (bumped via `tick` prop).
  useEffect(() => { refreshAll(); }, [refreshAll, tick]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="briefing-feed">
      <Banner
        status={status}
        progress={progress}
        running={running}
        onRefresh={onRefresh}
      />
      {error && <div className="briefing-error">⚠ {error}</div>}
      {items.length === 0 && !running && (
        <div className="briefing-empty">
          {status?.engineAvailable
            ? "暂无待办 · 点上面 ↻ 让 AI 重新评估邮件 + Topic"
            : "未检测到已登录的 Claude Code / Codex CLI · 先登录任一 CLI"}
        </div>
      )}
      <div className="brief-list">
        {items.map((it) => (
          <BriefCard
            key={it.id}
            item={it}
            topics={topics}
            draftResults={activeDrafts[it.id]}
            onAction={async (actionIndex) => {
              try {
                const results = await api.executeActionStep({
                  itemId: it.id,
                  actionIndex,
                  stepIndices: null,
                });
                setActiveDrafts((cur) => ({ ...cur, [it.id]: results }));

                // Surface every result as a toast so the user knows what
                // happened (previously: card just vanished with no feedback).
                for (const r of results) {
                  let msg = "";
                  let kind: "done" | "info" | "error" = "info";
                  if (r.kind === "Acknowledged") {
                    msg = r.message.startsWith("open_topic:")
                      ? "前往 Topic"
                      : "✓ 已确认";
                    kind = "done";
                  } else if (r.kind === "EventCreated") {
                    const when = r.allDay
                      ? new Date(r.startMs).toLocaleDateString("zh-CN")
                      : new Date(r.startMs).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "numeric", day: "numeric" });
                    msg = `✓ 已加日历: ${r.title} (${when})`;
                    kind = "done";
                  } else if (r.kind === "TaskCreated") {
                    const when = r.dueMs ? ` · 截止 ${new Date(r.dueMs).toLocaleDateString("zh-CN")}` : "";
                    msg = `✓ 已加待办: ${r.title}${when}`;
                    kind = "done";
                  } else if (r.kind === "ReplyDrafted") {
                    msg = "💬 回信草稿已生成 · 看下面审稿后发送";
                    kind = "info";
                  } else if (r.kind === "Skipped") {
                    msg = `⚠ 跳过: ${r.reason}`;
                    kind = "error";
                  }
                  window.dispatchEvent(new CustomEvent("salmon:toast", {
                    detail: { title: msg, kind },
                  }));
                }

                // Only reply drafts need user review (must read prose before
                // sending). Events/tasks auto-create so card can close.
                const hasInteractive = results.some(
                  (r) => r.kind === "ReplyDrafted"
                );
                // Don't close the card if every step failed (Skipped) —
                // user should be able to retry. Backend already keeps the
                // status='pending' in this case.
                const anySucceeded = results.some((r) => r.kind !== "Skipped");
                if (!hasInteractive && anySucceeded) {
                  setItems((cur) => cur.filter((x) => x.id !== it.id));
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
                await api.decideBriefItem(it.id, "muted");
                setItems((cur) => cur.filter((x) => x.id !== it.id));
                window.dispatchEvent(new CustomEvent("salmon:toast", {
                  detail: { title: "✓ 已压制此条目 · 不会再提示", kind: "done" },
                }));
              } catch (e: any) {
                window.dispatchEvent(new CustomEvent("salmon:toast", {
                  detail: { title: `操作失败: ${e}`, kind: "error" },
                }));
              }
            }}
            onClearDraft={() => setActiveDrafts((cur) => {
              const next = { ...cur };
              delete next[it.id];
              return next;
            })}
            onEventCreated={() => {
              // The "✓ 创建到日历" button calls this when the backend
              // confirms the event was actually written to Google/Graph.
              // Remove the card so it doesn't keep coming back.
              setItems((cur) => cur.filter((x) => x.id !== it.id));
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Banner({
  status,
  progress,
  running,
  onRefresh,
}: {
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
    if (stage === "pulse") return `分析联系人 ${progress?.current}/${progress?.total}…`;
    if (stage === "briefing") return "全局排序…";
    if (stage === "cross-link") return "查跨域关联…";
    return stage;
  }, [running, stage, progress]);

  return (
    <div className="briefing-banner">
      <span className={`banner-dot ${status?.engineAvailable ? "ok" : "off"}`} />
      <div className="banner-text">
        {running ? (
          <b>AI 正在评估… {note}</b>
        ) : status?.overview ? (
          <span>{status.overview}</span>
        ) : status?.engineAvailable ? (
          <span>尚未生成简报，点 ↻ 开始</span>
        ) : (
          <span style={{ color: "#B7493D" }}>未检测到已登录 CLI</span>
        )}
      </div>
      {status?.generatedAt && !running && (
        <span className="banner-time">{timeAgo(status.generatedAt)}</span>
      )}
      <button className="banner-refresh" disabled={running} onClick={() => onRefresh()}>
        {running ? "评估中…" : "↻ 刷新"}
      </button>
    </div>
  );
}

function BriefCard({
  item,
  topics,
  draftResults,
  onAction,
  onDismiss,
  onClearDraft,
  onEventCreated,
}: {
  item: BriefItem;
  topics: Topic[];
  draftResults: StepResult[] | undefined;
  onAction: (actionIndex: number) => Promise<void>;
  onDismiss: () => void;
  onClearDraft: () => void;
  onEventCreated: () => void;
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

  const icon = item.kind === "cross" ? "🔗" : item.kind === "topic" ? "💬" : item.kind === "event" ? "📅" : "📧";
  const klass = `brief-card brief-${item.kind} prio-${item.priority}`;
  const topicTitle = item.topicId
    ? topics.find((t) => t.id === item.topicId)?.title
    : undefined;

  return (
    <div className={klass}>
      {item.kind === "cross" && <div className="brief-cross-tag">📧 + 💬 关联</div>}
      <div className="brief-head">
        <div className="brief-icon">{icon}</div>
        <div className="brief-titles">
          <div className="brief-title">{item.title}</div>
          <div className="brief-meta">
            <span className={`prio-pill prio-${item.priority}`}>{labelPriority(item.priority)}</span>
            {item.contactEmail && <span className="brief-contact">{item.contactEmail}</span>}
            {topicTitle && <span className="brief-topic-pill">{topicTitle}</span>}
          </div>
        </div>
      </div>

      {item.summary && <div className="brief-summary">{item.summary}</div>}

      {item.why && (
        <div className="brief-why">
          <span className="brief-why-label">↗ AI 解释：</span>
          {item.why}
        </div>
      )}

      <div className="brief-actions-section">
        <div className="brief-actions-label">建议你怎么处理</div>
        <div className="brief-actions">
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
          <button className="brief-btn dismiss" onClick={onDismiss}>不重要 · 不再提示</button>
        </div>
      </div>

      {draftResults && draftResults.length > 0 && (
        <DraftPanel
          results={draftResults}
          itemAccountHint={item.contactEmail}
          onClose={onClearDraft}
          onEventCreated={onEventCreated}
        />
      )}
    </div>
  );
}

function DraftPanel({
  results,
  onClose,
}: {
  results: StepResult[];
  // itemAccountHint kept around for future fields like signature picker.
  itemAccountHint: string | undefined | null;
  onClose: () => void;
  onEventCreated: () => void;
}) {
  // v0.9.2: only ReplyDrafted shows here. Events / tasks auto-create in
  // the backend so they only need a success toast, not a confirm-create
  // button. Skipped results show as a small inline warning.
  return (
    <div className="brief-drafts">
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
        // EventCreated / TaskCreated / Acknowledged already toasted; no inline UI.
        return null;
      })}
    </div>
  );
}

function labelPriority(p: string): string {
  return p === "high" ? "高" : p === "low" ? "低" : "中";
}

function timeAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "刚刚";
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 86400_000)} 天前`;
}
