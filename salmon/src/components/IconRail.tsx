import type { CliInfo } from "../lib/types";

/**
 * v0.11 — top-level icon rail. Replaces the Home / Mail / Calendar / Tasks
 * buttons that previously lived at the top of LeftSidebar. Each rail item
 * is a ghost icon (no individual card border) on the cream rail bg —
 * hover and active states paint a salmon-100 pill + a salmon-700 left
 * indicator bar (Option A from the v0.11 mockup).
 *
 * v1.0 — emoji glyphs replaced with monochrome line icons (mockup option B):
 * 24×24 stroked SVGs that inherit currentColor, so the rail can pick the
 * default / hover / active color in CSS. One inline sprite renders the
 * shared <symbol> defs once per IconRail mount.
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
  { id: "home",     icon: "i-home",  title: "首页 · 今日聚焦" },
  { id: "contacts", icon: "i-users", title: "联系人" },
  { id: "mail",     icon: "i-mail",  title: "邮件" },
  { id: "calendar", icon: "i-cal",   title: "日历" },
  { id: "tasks",    icon: "i-tasks", title: "待办" },
  { id: "topic",    icon: "i-chat",  title: "Topic 对话" },
];

function RailSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-home" viewBox="0 0 24 24">
          <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z" />
        </symbol>
        <symbol id="i-users" viewBox="0 0 24 24">
          <circle cx="9" cy="8" r="3.5" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.7-4.8-4-5.6" />
        </symbol>
        <symbol id="i-mail" viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </symbol>
        <symbol id="i-cal" viewBox="0 0 24 24">
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </symbol>
        <symbol id="i-tasks" viewBox="0 0 24 24">
          <path d="m4 7 2 2 3.5-3.5M4 14l2 2 3.5-3.5" />
          <path d="M12 7h8M12 14h8M4 20.5h16" />
        </symbol>
        <symbol id="i-chat" viewBox="0 0 24 24">
          <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3.5V6a1 1 0 0 1 1-1Z" />
        </symbol>
        <symbol id="i-search" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.3-4.3" />
        </symbol>
        <symbol id="i-gear" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.4l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </symbol>
      </defs>
    </svg>
  );
}

function Glyph({ id }: { id: string }) {
  return (
    <svg className="rail-glyph" aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

export function IconRail(props: Props) {
  const badgeFor = (id: RailView): number | null => {
    if (id === "home" && props.briefCount > 0) return props.briefCount;
    if (id === "mail" && props.unreadMail > 0) return props.unreadMail;
    if (id === "tasks" && props.pendingTasks > 0) return props.pendingTasks;
    return null;
  };

  return (
    <aside className="icon-rail" role="navigation">
      <RailSprite />
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
            <Glyph id={n.icon} />
            {badge !== null && <span className="rail-badge">{badge > 99 ? "99+" : badge}</span>}
          </button>
        );
      })}

      <div className="rail-spacer" />

      <button className="rail-item" title="全局搜索 Topic / 邮件" onClick={props.onOpenSearch}>
        <Glyph id="i-search" />
      </button>
      <button className="rail-item" title="设置 / CLI 状态" onClick={props.onOpenSettings}>
        <Glyph id="i-gear" />
      </button>

      <div className="rail-cli-status">
        {props.cliStatus.map((c) => {
          const cls = !c.installed ? "miss" : c.loggedIn ? "ok" : "warn";
          const short = c.binary === "claude" ? "CC" : "CX";
          return (
            <button
              key={c.binary}
              className={`rail-cli-pill ${cls}`}
              title={`${c.name}: ${!c.installed ? "未安装" : c.loggedIn ? "已登录" : "未登录"}`}
              onClick={props.onOpenSettings}
            >
              <span className="rail-cli-mark" />
              <span>{short}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
