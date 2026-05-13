import { useMemo } from "react";
import type { BriefingProgress, Recommendation, Topic, UsageSummary } from "../lib/types";
import { relativeTime } from "../lib/format";
import { BriefingFeed } from "./BriefingFeed";

interface PendingPerm {
  id: string;
  tool: string;
  input: any;
  command: string | null;
}

interface Props {
  topics: Topic[];
  lastReadAt: Record<string, number>;
  pendingPermByTopic: Record<string, PendingPerm | null>;
  errorByTopic: Record<string, string | null>;
  workdirOkByTopic: Record<string, boolean>;
  runningIds: Set<string>;
  recommendations: Recommendation[];
  recsLoading: boolean;
  recsError: string | null;
  onRefreshRecs: () => void;
  onDecideRec: (id: string, decision: "accepted" | "ignored") => void;
  onAcceptRec: (rec: Recommendation) => void;
  onSelect: (id: string) => void;
  onNewTopic: () => void;
  usageSummary: UsageSummary | null;
  // v0.9.1 — briefing pipeline state lives in App.tsx (survives navigation
  // between home/topic views). BriefingFeed reads these as props.
  briefingRunning: boolean;
  briefingProgress: BriefingProgress | null;
  briefingTick: number;
  onRunBriefing: () => Promise<void> | void;
}

interface Row {
  topic: Topic;
  status: "needs-input" | "error" | "running" | "unread" | "missing-workdir" | "ok";
  badgeText: string | null;
}

function currentHome(): string {
  if (typeof window === "undefined") return "";
  return (window as any).__SALMON_HOME__ || "";
}

export function WelcomeBack({
  topics,
  lastReadAt,
  pendingPermByTopic,
  errorByTopic,
  workdirOkByTopic,
  recommendations,
  recsLoading,
  recsError,
  onRefreshRecs,
  onDecideRec,
  onAcceptRec,
  onSelect,
  onNewTopic,
  usageSummary,
  runningIds,
  briefingRunning,
  briefingProgress,
  briefingTick,
  onRunBriefing,
}: Props) {
  const rows: Row[] = useMemo(() => {
    const live = topics.filter((t) => !t.archived);
    return live.map((t): Row => {
      if (workdirOkByTopic[t.id] === false) {
        return { topic: t, status: "missing-workdir", badgeText: "工作目录失效" };
      }
      if (pendingPermByTopic[t.id]) {
        return { topic: t, status: "needs-input", badgeText: "需要授权" };
      }
      if (errorByTopic[t.id]) {
        return { topic: t, status: "error", badgeText: "出错" };
      }
      if (runningIds.has(t.id)) {
        return { topic: t, status: "running", badgeText: "运行中" };
      }
      const seen = lastReadAt[t.id] || 0;
      if (t.updatedAt > seen) {
        return { topic: t, status: "unread", badgeText: "未读" };
      }
      return { topic: t, status: "ok", badgeText: null };
    });
  }, [topics, lastReadAt, pendingPermByTopic, errorByTopic, workdirOkByTopic, runningIds]);

  const attention = useMemo(
    () =>
      rows
        .filter((r) => r.status !== "ok")
        .sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.topic.updatedAt - a.topic.updatedAt),
    [rows]
  );
  const recents = useMemo(
    () => rows.filter((r) => r.status === "ok").sort((a, b) => b.topic.updatedAt - a.topic.updatedAt).slice(0, 8),
    [rows]
  );

  const totalLive = rows.length;

  // v0.9.1 — single LLM-driven feed replaces the old four-block layout.
  // The old Recommendations pipeline still produces rows in the
  // `recommendations` table; BriefingFeed pulls them in via the
  // orchestrator's topic-engine side. The `recommendations` prop is no
  // longer rendered here directly — left in the signature to keep the
  // parent code unchanged.
  void recommendations; void recsLoading; void recsError; void onRefreshRecs;
  void onDecideRec; void onAcceptRec;
  void totalLive;

  // v0.11.1: home view IS the BriefingFeed (3-pane). The "welcome back"
  // overview + recent/attention topics now live in BriefingFeed's
  // detail pane when no brief item is selected.
  const recentTopics = useMemo(() => recents.map((r) => r.topic), [recents]);
  const attentionTopics = useMemo(
    () => attention.map((r) => ({ topic: r.topic, reason: r.badgeText || "需看" })),
    [attention]
  );

  return (
    <BriefingFeed
      topics={topics}
      onOpenTopic={onSelect}
      running={briefingRunning}
      progress={briefingProgress}
      tick={briefingTick}
      onRefresh={onRunBriefing}
      usageSummary={usageSummary}
      recentTopics={recentTopics}
      attentionTopics={attentionTopics}
      recommendations={recommendations}
      onNewTopic={onNewTopic}
    />
  );
}

function SessionRow({ row, onClick }: { row: Row; onClick: () => void }) {
  const { topic, status, badgeText } = row;
  return (
    <div className="welcome-row" onClick={onClick} role="button">
      <span className={`welcome-badge ${status}`}>
        {badgeText ? (
          <>
            <span className="welcome-badge-dot" />
            {badgeText}
          </>
        ) : (
          <span className="welcome-badge-dot dim" />
        )}
      </span>
      <span className={`engine-pill ${topic.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
        {topic.engine === "claude" ? "CC" : "CX"}
      </span>
      <span className="welcome-row-title">{topic.title || "(未命名)"}</span>
      <span className="welcome-row-path">{shortPath(topic.workdir)}</span>
      <span className="welcome-row-time">{relativeTime(topic.updatedAt)}</span>
      <span className="welcome-row-chev">›</span>
    </div>
  );
}

function statusRank(s: Row["status"]): number {
  if (s === "needs-input") return 0;
  if (s === "error") return 1;
  if (s === "missing-workdir") return 2;
  if (s === "running") return 3;
  if (s === "unread") return 4;
  return 5;
}

function shortPath(p: string): string {
  const home = currentHome();
  let q = p;
  if (home && p.startsWith(home)) q = "~" + p.slice(home.length);
  if (q.length <= 36) return q;
  const parts = q.split("/").filter(Boolean);
  if (parts.length <= 2) return q;
  return "…/" + parts.slice(-2).join("/");
}


/**
 * Compact usage rollup: today / 7d / 30d / total, plus a one-line
 * by-engine breakdown. Numbers only — user opted against a chart;
 * cost estimation is also out (no price table to maintain).
 */
function UsageCard({ summary }: { summary: UsageSummary }) {
  const cells: Array<{ label: string; tokens: number }> = [
    { label: "今日", tokens: summary.todayIn + summary.todayOut },
    { label: "近 7 天", tokens: summary.weekIn + summary.weekOut },
    { label: "近 30 天", tokens: summary.monthIn + summary.monthOut },
    { label: "累计", tokens: summary.totalIn + summary.totalOut },
  ];
  return (
    <div className="usage-card">
      <div className="usage-row">
        {cells.map((c) => (
          <div key={c.label} className="usage-cell">
            <div className="usage-cell-label">{c.label}</div>
            <div className="usage-cell-val">{compactTokens(c.tokens)}</div>
          </div>
        ))}
      </div>
      {summary.byEngine.length > 0 && (
        <div className="usage-engine-row">
          {summary.byEngine.map((eu) => (
            <span key={eu.engine} className="usage-engine">
              <span className={`engine-pill ${eu.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                {eu.engine === "claude" ? "CC" : "CX"}
              </span>
              <span style={{ marginLeft: 6 }}>
                {compactTokens(eu.totalIn + eu.totalOut)} ({compactTokens(eu.totalIn)} in · {compactTokens(eu.totalOut)} out)
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function compactTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

