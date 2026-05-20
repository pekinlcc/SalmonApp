// Center widget. Four modes (idle / collapsed / overview / expanded) matching
// the Anthropic design. Source data is real — comes from useDesktopBrief —
// and is converted into BriefItem rows below. When the user has nothing
// pending the widget shows the calm "idle" pill instead of an empty card.
import { ReactNode } from "react";
import { Icons } from "./Icons";
import type { BriefSnapshot } from "../../lib/useDesktopBrief";

export type WidgetMode = "idle" | "collapsed" | "overview" | "expanded";

interface BriefItem {
  kind: "mail" | "cal" | "task" | "doc" | "meet" | "ai";
  chip?: string;
  chipKind?: "info" | "ok" | "warn";
  title: string;
  who?: string;
  meta?: string;
  tail?: string;
  cta?: string;
  onClick?: () => void;
}

const ICON_FOR_KIND: Record<BriefItem["kind"], (props: { width?: number; height?: number }) => JSX.Element> = {
  mail: Icons.Mail,
  cal: Icons.Calendar,
  task: Icons.CheckSquare,
  doc: Icons.Doc,
  meet: Icons.Video,
  ai: Icons.AIStar,
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function relativeMin(targetMs: number): { chip: string; chipKind: BriefItem["chipKind"] } {
  const diff = targetMs - Date.now();
  if (diff < 0) return { chip: "已开始", chipKind: "warn" };
  const m = Math.round(diff / 60_000);
  if (m < 60) return { chip: `${m} 分钟后`, chipKind: m <= 30 ? "warn" : "info" };
  const h = Math.round(m / 60);
  if (h < 24) return { chip: `${h} 小时后`, chipKind: "info" };
  return { chip: `${Math.round(h / 24)} 天后`, chipKind: "info" };
}

function relativeDay(ms: number): string {
  const diff = ms - Date.now();
  const d = Math.round(diff / (24 * 60 * 60 * 1000));
  if (d <= -1) return `${-d} 天前`;
  if (d === 0) return "今天";
  if (d === 1) return "明天";
  return `${d} 天后`;
}

export interface WidgetCallbacks {
  onNavigateMail: () => void;
  onNavigateCalendar: () => void;
  onNavigateTasks: () => void;
  onNavigateHome: () => void;
}

/** Convert real BriefSnapshot data into BriefItem rows. Ordering:
 *  next meeting (most urgent) → AI recs → unread mail → today tasks. */
function snapToItems(snap: BriefSnapshot, cb: WidgetCallbacks): BriefItem[] {
  const items: BriefItem[] = [];

  if (snap.nextEvent) {
    const r = relativeMin(snap.nextEvent.startMs);
    items.push({
      kind: "meet",
      chip: r.chip,
      chipKind: r.chipKind,
      title: snap.nextEvent.title || "(无标题会议)",
      meta: fmtTime(snap.nextEvent.startMs),
      tail: snap.nextEvent.location || undefined,
      cta: "加入",
      onClick: cb.onNavigateCalendar,
    });
  }

  snap.recs.forEach((r) => {
    items.push({
      kind: "ai",
      chip: r.priority === "high" ? "重要" : "建议",
      chipKind: r.priority === "high" ? "warn" : "info",
      title: r.title,
      meta: r.actionHint,
      cta: "查看",
      onClick: cb.onNavigateHome,
    });
  });

  if (snap.recentMail.length > 0) {
    snap.recentMail.forEach((m) => {
      items.push({
        kind: "mail",
        chip: "需回复",
        title: m.subject || "(无主题)",
        who: m.fromName || m.fromEmail || undefined,
        meta: relativeDay(m.dateMs),
        cta: "打开",
        onClick: cb.onNavigateMail,
      });
    });
  } else if (snap.unreadMail > 0) {
    items.push({
      kind: "mail",
      chip: `${snap.unreadMail} 封`,
      chipKind: "info",
      title: "未读邮件",
      meta: "点击查看收件箱",
      cta: "打开",
      onClick: cb.onNavigateMail,
    });
  }

  snap.todayTasks.forEach((t) => {
    items.push({
      kind: "task",
      chip: t.dueMs && t.dueMs < Date.now() ? "逾期" : "今天",
      chipKind: t.dueMs && t.dueMs < Date.now() ? "warn" : "info",
      title: t.title,
      meta: t.dueMs ? fmtTime(t.dueMs) : "无截止时间",
      cta: "开始",
      onClick: cb.onNavigateTasks,
    });
  });

  return items;
}

function buildSummary(snap: BriefSnapshot, items: BriefItem[]): ReactNode {
  if (items.length === 0) return "今天上午很安静，我帮你留意着。";

  const decisionCount = items.filter((i) => i.chipKind === "warn" || i.chip === "需回复").length;
  const nextEvent = snap.nextEvent;

  // Mirrors the design's "早上好 — 今天有 3 件需要决策的事，和一个 30 分钟后开始的会"
  const parts: ReactNode[] = [];
  if (decisionCount > 0) {
    parts.push(<>有 <em>{decisionCount} 件需要决策的事</em></>);
  }
  if (nextEvent) {
    const r = relativeMin(nextEvent.startMs);
    parts.push(<>一个 <em>{r.chip}</em>开始的会</>);
  }
  if (parts.length === 0) {
    return <>有 <em>{items.length} 条新动态</em>等你看一眼。</>;
  }
  if (parts.length === 1) {
    return <>{parts[0]}。</>;
  }
  return (
    <>
      {parts[0]}，和{parts[1]}。
    </>
  );
}

function BriefIconBox({ kind }: { kind: BriefItem["kind"] }) {
  const Icon = ICON_FOR_KIND[kind];
  return (
    <div className={`brief-icon bi-${kind}`}>
      <Icon />
    </div>
  );
}

function BriefRow({ item, primary }: { item: BriefItem; primary?: boolean }) {
  return (
    <div className="brief-item" onClick={item.onClick}>
      <BriefIconBox kind={item.kind} />
      <div className="brief-text">
        <div className="brief-title">
          {item.chip && (
            <span className={`chip${item.chipKind ? " --" + item.chipKind : ""}`}>{item.chip}</span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
        </div>
        <div className="brief-sub">
          {item.who && <span className="who">{item.who}</span>}
          {item.who && item.meta && <span className="dot-sep" />}
          {item.meta && <span>{item.meta}</span>}
          {item.tail && <span className="dot-sep" />}
          {item.tail && <span>{item.tail}</span>}
        </div>
      </div>
      <button
        className={"brief-cta" + (primary ? " --primary" : "")}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          item.onClick?.();
        }}
      >
        {item.cta || "查看"}
        <Icons.Arrow />
      </button>
    </div>
  );
}

interface AIOrbProps {
  size?: "xs" | "sm" | "md";
  pulse?: boolean;
}
function AIOrb({ size = "md", pulse = true }: AIOrbProps) {
  const cls = "ai-orb" + (size === "sm" ? " --sm" : size === "xs" ? " --xs" : "") + (pulse ? " --pulse" : "");
  return <div className={cls} aria-hidden="true" />;
}
export { AIOrb };

interface Props {
  mode: WidgetMode;
  snap: BriefSnapshot;
  onModeChange: (m: WidgetMode) => void;
  callbacks: WidgetCallbacks;
}

export function Widget({ mode, snap, onModeChange, callbacks }: Props) {
  const items = snapToItems(snap, callbacks);
  const summary = buildSummary(snap, items);

  const cls =
    "widget" +
    (mode === "collapsed" ? " widget--collapsed" : "") +
    (mode === "expanded" ? " widget--expanded" : "") +
    (mode === "idle" ? " widget--collapsed widget--idle" : "");

  if (mode === "idle") {
    return (
      <div className={cls}>
        <div className="widget-glow" />
        <div className="widget-inner">
          <AIOrb size="sm" pulse={false} />
          <div className="idle-text">
            <b>Salmon</b> · 今天上午很安静，我帮你留意着。
          </div>
        </div>
      </div>
    );
  }

  if (mode === "collapsed") {
    return (
      <div className={cls} onClick={() => onModeChange("overview")}>
        <div className="widget-glow" />
        <div className="widget-inner">
          <AIOrb size="sm" />
          <div className="collapsed-row">
            <div className="collapsed-text">
              你有 <b>{items.length} 件</b> <span className="quiet">需要看看的事</span>
            </div>
            <span className="count-pill">{items.length}</span>
          </div>
          <button className="w-action" title="展开" type="button">
            <Icons.ChevronUp />
          </button>
        </div>
      </div>
    );
  }

  const showThinking = mode === "expanded";
  const showComposer = mode === "expanded";
  const renderItems = mode === "expanded" ? items : items.slice(0, 3);

  const sources: string[] = [];
  // We don't have a hook field for # accounts so we read off the loading
  // flag heuristically; the design's "12 收件箱 · 3 日历" was placeholder
  // copy, so we paraphrase using real counts when available.
  if (snap.unreadMail > 0 || snap.recentMail.length > 0) sources.push("收件箱");
  if (snap.nextEvent) sources.push("日历");
  if (snap.todayTasks.length > 0) sources.push("待办");
  if (snap.recs.length > 0) sources.push("AI 推荐");

  return (
    <div className={cls}>
      <div className="widget-glow" />
      <div className="widget-inner">
        <div className="widget-header">
          <AIOrb size="md" pulse={showThinking} />
          <div className="widget-label">
            <div className="ttl">
              Salmon Brief{" "}
              <span style={{ opacity: 0.5, fontWeight: 400 }}>
                ·{" "}
                {snap.refreshedAt
                  ? new Date(snap.refreshedAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: false,
                    }) + " 更新"
                  : snap.loading
                    ? "正在加载…"
                    : "刚刚更新"}
              </span>
            </div>
            <div className="sub">
              <span className="live-dot" />
              {sources.length > 0
                ? `正在为你跟进 ${sources.join(" · ")}`
                : "暂无数据源 — 在设置里连接邮箱 / 日历"}
            </div>
          </div>
          <div className="widget-actions">
            <button className="w-action" title="刷新" type="button">
              <Icons.Sparkle />
            </button>
            <button className="w-action" title="更多" type="button">
              <Icons.More />
            </button>
            <button
              className="w-action"
              title={mode === "expanded" ? "收起" : "展开"}
              type="button"
              onClick={() => onModeChange(mode === "expanded" ? "overview" : "expanded")}
            >
              {mode === "expanded" ? <Icons.ChevronDown /> : <Icons.ChevronUp />}
            </button>
            <button
              className="w-action"
              title="收为药丸"
              type="button"
              onClick={() => onModeChange("collapsed")}
            >
              <Icons.Close />
            </button>
          </div>
        </div>

        <div className="widget-body">
          <p className="brief-summary">{summary}</p>

          {showThinking && snap.loading && (
            <div className="thinking-row">
              <span className="typing">
                <span />
                <span />
                <span />
              </span>
              <span>正在为你串起最新的邮件、日程和待办…</span>
            </div>
          )}

          <div className="brief-list">
            {renderItems.length > 0 ? (
              renderItems.map((it, i) => <BriefRow key={i} item={it} primary={i === 0} />)
            ) : (
              <div className="brief-item brief-item--empty">
                <BriefIconBox kind="ai" />
                <div className="brief-text">
                  <div className="brief-title">
                    <span>今天没有需要你立刻决策的事项</span>
                  </div>
                  <div className="brief-sub">
                    <span>连接 Gmail / Outlook / Google Calendar 后这里会更有用</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {showComposer && (
            <div className="composer">
              <span style={{ color: "rgba(255,255,255,0.5)", display: "inline-flex" }}>
                <Icons.Sparkle />
              </span>
              <input placeholder="问 Salmon 任何事，或让它帮你处理…" />
              <button className="composer-send" title="发送" type="button">
                <Icons.Send />
              </button>
            </div>
          )}

          <div className="brief-footer">
            <div className="brief-footer-left">
              按 <span className="kbd">Super</span> 打开 Launcher · <span className="kbd">⌘ K</span> 召唤 Salmon
            </div>
            <div className="brief-quick">
              <button className="qa-chip qa-chip--mail" type="button" onClick={callbacks.onNavigateMail}>
                <Icons.Mail /> 收件箱
              </button>
              <button className="qa-chip qa-chip--cal" type="button" onClick={callbacks.onNavigateCalendar}>
                <Icons.Calendar /> 今日
              </button>
              <button className="qa-chip qa-chip--task" type="button" onClick={callbacks.onNavigateTasks}>
                <Icons.CheckSquare /> 待办
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Exposed for AILiveTile / AIPeek / AIPopover so they share the same
 *  data-derivation as the center widget. */
export const widgetHelpers = { snapToItems, buildSummary, relativeMin, fmtTime };
