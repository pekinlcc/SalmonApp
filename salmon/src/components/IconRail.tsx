import type { CliInfo } from "../lib/types";

/**
 * v0.11 — top-level icon rail. Replaces the Home / Mail / Calendar / Tasks
 * buttons that previously lived at the top of LeftSidebar. Each rail item
 * is a ghost icon (no individual card border) on the cream rail bg —
 * hover and active states paint a salmon-100 pill + a salmon-700 left
 * indicator bar (Option A from the v0.11 mockup).
 *
 * The Topic list, search box and new-topic button stay in LeftSidebar.
 * LeftSidebar is now rendered as the "list pane" of the 3-column shell
 * when the Topic view is active.
 */
export type RailView = "home" | "contacts" | "mail" | "calendar" | "tasks" | "topic";

interface Props {
  view: RailView;
  unreadMail: number;
  pendingTasks: number;
  briefCount: number;
  cliStatus: CliInfo[];
  onView: (v: RailView) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}

const NAV: Array<{ id: RailView; icon: string; title: string }> = [
  { id: "home",     icon: "✦", title: "首页 · 今日聚焦" },
  { id: "contacts", icon: "👥", title: "联系人" },
  { id: "mail",     icon: "📧", title: "邮件" },
  { id: "calendar", icon: "📅", title: "日历" },
  { id: "tasks",    icon: "📋", title: "待办" },
  { id: "topic",    icon: "💬", title: "Topic 对话" },
];

export function IconRail(props: Props) {
  const badgeFor = (id: RailView): number | null => {
    if (id === "home" && props.briefCount > 0) return props.briefCount;
    if (id === "mail" && props.unreadMail > 0) return props.unreadMail;
    if (id === "tasks" && props.pendingTasks > 0) return props.pendingTasks;
    return null;
  };

  return (
    <aside className="icon-rail" role="navigation">
      {NAV.map((n) => {
        const active = props.view === n.id;
        const badge = badgeFor(n.id);
        return (
          <button
            key={n.id}
            className={`rail-item ${active ? "active" : ""}`}
            title={n.title}
            onClick={() => props.onView(n.id)}
          >
            <span className="rail-glyph">{n.icon}</span>
            {badge !== null && <span className="rail-badge">{badge > 99 ? "99+" : badge}</span>}
          </button>
        );
      })}

      <div className="rail-spacer" />

      <button className="rail-item" title="全局搜索 Topic / 邮件" onClick={props.onOpenSearch}>
        <span className="rail-glyph">🔍</span>
      </button>
      <button className="rail-item" title="设置 / CLI 状态" onClick={props.onOpenSettings}>
        <span className="rail-glyph">⚙</span>
      </button>

      <div className="rail-cli-status">
        {props.cliStatus.map((c) => {
          const cls = !c.installed ? "miss" : c.loggedIn ? "ok" : "warn";
          return (
            <span
              key={c.binary}
              className={`rail-cli-dot ${cls}`}
              title={`${c.name}: ${!c.installed ? "未安装" : c.loggedIn ? "已登录" : "未登录"}`}
            />
          );
        })}
      </div>
    </aside>
  );
}
