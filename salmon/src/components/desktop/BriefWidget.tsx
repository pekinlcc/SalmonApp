// AI Brief widget — the centerpiece of the desktop. Three states driven by
// the data the hook collects:
//
//   - idle      → nothing to show, calm pill ("AI 帮你留意着")
//   - collapsed → 1-2 items, pill with count, click expands
//   - overview  → 3+ items, full card with sections
//
// User can manually toggle between collapsed and overview by clicking the
// widget. The "expanded" state with composer from the prototype is deferred
// to Phase 2 (it overlaps with the existing chat composer; not worth two
// places to send to the same engine).
import { useState } from "react";
import type { BriefSnapshot } from "../../lib/useDesktopBrief";
import { briefItemCount } from "../../lib/useDesktopBrief";

interface Props {
  snap: BriefSnapshot;
  onNavigateMail: () => void;
  onNavigateCalendar: () => void;
  onNavigateTasks: () => void;
  onNavigateHome: () => void;
}

type Mode = "auto" | "collapsed" | "overview";

function relativeMin(targetMs: number): string {
  const diff = targetMs - Date.now();
  if (diff < 0) return "已开始";
  const m = Math.round(diff / 60_000);
  if (m < 60) return `还有 ${m} 分钟`;
  const h = Math.round(m / 60);
  return `还有 ${h} 小时`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function BriefWidget({
  snap,
  onNavigateMail,
  onNavigateCalendar,
  onNavigateTasks,
  onNavigateHome,
}: Props) {
  const [mode, setMode] = useState<Mode>("auto");
  const count = briefItemCount(snap);

  // Resolve auto → idle/collapsed/overview based on item count.
  let effective: "idle" | "collapsed" | "overview";
  if (mode === "auto") {
    if (count === 0) effective = "idle";
    else if (count <= 2) effective = "collapsed";
    else effective = "overview";
  } else {
    effective = mode;
  }

  if (effective === "idle") {
    return (
      <div className="dt-brief dt-brief-idle" role="status" aria-live="polite">
        <span className="dt-brief-orb dt-brief-orb-quiet" aria-hidden />
        <span className="dt-brief-idle-text">
          {snap.loading ? "AI 正在为你看一眼当前状况…" : "今天暂时没事 · AI 帮你留意着"}
        </span>
      </div>
    );
  }

  if (effective === "collapsed") {
    return (
      <button
        type="button"
        className="dt-brief dt-brief-pill"
        onClick={() => setMode("overview")}
        aria-label={`你有 ${count} 件需要看看的事 · 点击展开`}
      >
        <span className="dt-brief-orb" aria-hidden />
        <span className="dt-brief-pill-text">
          你有 <strong>{count}</strong> 件需要看看的事
        </span>
        <span className="dt-brief-pill-badge">{count}</span>
      </button>
    );
  }

  // overview
  return (
    <div className="dt-brief dt-brief-card" role="region" aria-label="Salmon Brief">
      <div className="dt-brief-head">
        <span className="dt-brief-orb" aria-hidden />
        <div className="dt-brief-head-text">
          <div className="dt-brief-title">Salmon Brief</div>
          <div className="dt-brief-sub">AI 正在为你监控 · {count} 条待看</div>
        </div>
        <button
          type="button"
          className="dt-brief-collapse"
          onClick={() => setMode("collapsed")}
          title="折叠为药丸"
        >
          −
        </button>
      </div>

      <div className="dt-brief-sections">
        {snap.nextEvent && (
          <button
            type="button"
            className="dt-brief-section dt-brief-event"
            onClick={onNavigateCalendar}
          >
            <span className="dt-brief-section-icon">📅</span>
            <div className="dt-brief-section-body">
              <div className="dt-brief-section-title">
                下一个 · {fmtTime(snap.nextEvent.startMs)} {snap.nextEvent.title || "(无标题)"}
              </div>
              <div className="dt-brief-section-sub">
                {relativeMin(snap.nextEvent.startMs)}
                {snap.nextEvent.location ? ` · ${snap.nextEvent.location}` : ""}
              </div>
            </div>
          </button>
        )}

        {snap.unreadMail > 0 && (
          <button
            type="button"
            className="dt-brief-section dt-brief-mail"
            onClick={onNavigateMail}
          >
            <span className="dt-brief-section-icon">✉</span>
            <div className="dt-brief-section-body">
              <div className="dt-brief-section-title">{snap.unreadMail} 封未读邮件</div>
              {snap.recentMail.length > 0 && (
                <div className="dt-brief-section-sub">
                  {snap.recentMail
                    .slice(0, 2)
                    .map((m) => m.subject || "(无主题)")
                    .join(" · ")}
                </div>
              )}
            </div>
          </button>
        )}

        {snap.todayTasks.length > 0 && (
          <button
            type="button"
            className="dt-brief-section dt-brief-tasks"
            onClick={onNavigateTasks}
          >
            <span className="dt-brief-section-icon">✓</span>
            <div className="dt-brief-section-body">
              <div className="dt-brief-section-title">
                今天 {snap.todayTasks.length} 件任务
              </div>
              <div className="dt-brief-section-sub">
                {snap.todayTasks
                  .slice(0, 2)
                  .map((t) => t.title)
                  .join(" · ")}
              </div>
            </div>
          </button>
        )}

        {snap.recs.length > 0 && (
          <button
            type="button"
            className="dt-brief-section dt-brief-recs"
            onClick={onNavigateHome}
          >
            <span className="dt-brief-section-icon">✦</span>
            <div className="dt-brief-section-body">
              <div className="dt-brief-section-title">
                AI 建议 · {snap.recs[0].title}
              </div>
              <div className="dt-brief-section-sub">
                {snap.recs[0].payoff || snap.recs[0].rationale}
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
