import { useMemo, useState } from "react";
import type { Recommendation, Topic } from "../lib/types";
import { relativeTime } from "../lib/format";

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
  recommendations: Recommendation[];
  recsLoading: boolean;
  recsError: string | null;
  onRefreshRecs: () => void;
  onDecideRec: (id: string, decision: "accepted" | "ignored") => void;
  onAcceptRec: (rec: Recommendation) => void;
  onSelect: (id: string) => void;
  onNewTopic: () => void;
}

interface Row {
  topic: Topic;
  status: "needs-input" | "unread" | "missing-workdir" | "ok";
  badgeText: string | null;
}

const HOME = (typeof window !== "undefined" && (window as any).__SALMON_HOME__) || "";

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
      const seen = lastReadAt[t.id] || 0;
      if (t.updatedAt > seen) {
        return { topic: t, status: "unread", badgeText: "未读" };
      }
      return { topic: t, status: "ok", badgeText: null };
    });
  }, [topics, lastReadAt, pendingPermByTopic, errorByTopic, workdirOkByTopic]);

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

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-head">
          <div className="welcome-title">
            <span className="welcome-spark">✦</span> 欢迎回来
          </div>
          <div className="welcome-sub">
            {totalLive === 0
              ? "还没有 Topic — 新建一个开始。"
              : attention.length === 0
              ? `${totalLive} 个 Topic,都看过了。`
              : `${attention.length} / ${totalLive} 个 Topic 需要看一眼。`}
          </div>
        </div>

        <section className="welcome-section">
          <div className="welcome-section-head">
            <div className="welcome-section-label">推荐</div>
            <button
              className="welcome-refresh-btn"
              onClick={onRefreshRecs}
              disabled={recsLoading}
              title="重新让 Claude / Codex 给出建议"
            >
              {recsLoading ? "↻ 思考中…" : "↻ 刷新"}
            </button>
          </div>
          {recsError && !recsLoading && (
            <div className="welcome-recs-error">{recsError}</div>
          )}
          {!recsLoading && !recsError && recommendations.length === 0 && (
            <div className="welcome-recs-empty">
              暂无推荐。点"刷新"让 Claude / Codex 看看你最近聊了什么、可以做点什么。
            </div>
          )}
          <RecommendationsList
            recs={recommendations}
            topics={topics}
            onAccept={(r) => onAcceptRec(r)}
            onIgnore={(r) => onDecideRec(r.id, "ignored")}
          />
        </section>

        {attention.length > 0 && (
          <section className="welcome-section">
            <div className="welcome-section-label">Sessions</div>
            <div className="welcome-list">
              {attention.map((r) => (
                <SessionRow key={r.topic.id} row={r} onClick={() => onSelect(r.topic.id)} />
              ))}
            </div>
          </section>
        )}

        {recents.length > 0 && (
          <section className="welcome-section">
            <div className="welcome-section-label">Recent</div>
            <div className="welcome-list">
              {recents.map((r) => (
                <SessionRow key={r.topic.id} row={r} onClick={() => onSelect(r.topic.id)} />
              ))}
            </div>
          </section>
        )}

        <div className="welcome-foot">
          <button className="btn primary" onClick={onNewTopic}>+ 新建 Topic</button>
        </div>
      </div>
    </div>
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

function RecommendationsList({
  recs,
  topics,
  onAccept,
  onIgnore,
}: {
  recs: Recommendation[];
  topics: Topic[];
  onAccept: (r: Recommendation) => void;
  onIgnore: (r: Recommendation) => void;
}) {
  const [showOthers, setShowOthers] = useState(false);
  const high = recs.filter((r) => r.priority === "high");
  const others = recs.filter((r) => r.priority !== "high");
  return (
    <div className="welcome-recs-list">
      {high.map((r) => (
        <RecommendationCard
          key={r.id}
          rec={r}
          topicTitle={r.topicId ? topics.find((t) => t.id === r.topicId)?.title : null}
          onAccept={() => onAccept(r)}
          onIgnore={() => onIgnore(r)}
        />
      ))}
      {others.length > 0 && (
        <details className="rec-others" open={showOthers} onToggle={(e) => setShowOthers((e.target as HTMLDetailsElement).open)}>
          <summary className="rec-others-head">
            <span className="caret">▸</span>
            其他建议 <span className="rec-others-count">{others.length}</span>
            <span className="rec-others-hint">单方推荐 · 双方未一致 high</span>
          </summary>
          <div className="rec-others-body">
            {others.map((r) => (
              <RecommendationCard
                key={r.id}
                rec={r}
                topicTitle={r.topicId ? topics.find((t) => t.id === r.topicId)?.title : null}
                onAccept={() => onAccept(r)}
                onIgnore={() => onIgnore(r)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RecommendationCard({
  rec,
  topicTitle,
  onAccept,
  onIgnore,
}: {
  rec: Recommendation;
  topicTitle: string | null | undefined;
  onAccept: () => void;
  onIgnore: () => void;
}) {
  const sourceLabel = rec.sourceEngine === "claude" ? "Claude Code" : "Codex";
  const sourceClass = rec.sourceEngine === "claude" ? "rec-src-cc" : "rec-src-cx";
  const otherEngine = rec.sourceEngine === "claude" ? "Codex" : "Claude Code";
  return (
    <div className={`rec-card prio-${rec.priority}`}>
      <div className="rec-head">
        <span className={`rec-source ${sourceClass}`}>{sourceLabel}</span>
        <span className={`rec-prio rec-prio-${rec.priority}`}>
          {rec.priority === "high" ? "★ 高价值" : rec.priority === "medium" ? "中" : "弱"}
        </span>
        <span className="rec-rating-detail" title={`${sourceLabel} 自评 / ${otherEngine} 互评`}>
          {labelVal(rec.selfValue)} · {otherEngine === "Codex" ? "↗ Codex" : "↗ Claude"} {labelVal(rec.peerValue)}
        </span>
        <span className="rec-time">{relativeTime(rec.generatedAt)}</span>
      </div>
      <div className="rec-title">{rec.title}</div>
      <div className="rec-rationale">{rec.rationale}</div>
      <div className="rec-meta">
        {topicTitle && <span className="rec-topic">↳ Topic: {topicTitle}</span>}
        <span className="rec-action">下一步: {rec.actionHint}</span>
      </div>
      <div className="rec-actions">
        <button
          className="btn primary"
          onClick={onAccept}
          title={rec.topicId ? `跳到该 Topic 并自动发送:"${rec.actionHint}"` : "标记同意"}
        >
          ✓ 同意 · 开干
        </button>
        <button className="btn" onClick={onIgnore} title="标记忽略,不发消息">× 忽略</button>
      </div>
    </div>
  );
}

function labelVal(v: string | null): string {
  if (v === "high") return "高";
  if (v === "medium") return "中";
  if (v === "low") return "弱";
  return "—";
}

function statusRank(s: Row["status"]): number {
  return s === "needs-input" ? 0 : s === "missing-workdir" ? 1 : s === "unread" ? 2 : 3;
}

function shortPath(p: string): string {
  let q = p;
  if (HOME && p.startsWith(HOME)) q = "~" + p.slice(HOME.length);
  if (q.length <= 36) return q;
  const parts = q.split("/").filter(Boolean);
  if (parts.length <= 2) return q;
  return "…/" + parts.slice(-2).join("/");
}
