// Bottom dock — three sections: launcher trigger | Brief icon | app shortcuts.
// In Phase 1 every click just switches the existing top-level view; Phase 2
// will swap these for separate Tauri windows so a real GNOME taskbar shows
// "Salmon Mail" / "Salmon Calendar" as distinct apps.
//
// v1.20.1: shows a small "running" dot under app icons that have content
// pending (unread mail, today tasks, etc.) — same signal the IconRail
// already exposes in normal mode.
import type { ReactNode } from "react";

interface DockItem {
  id: string;
  label: string;
  glyph: ReactNode;
  onClick: () => void;
  badge?: number;
  hasActivity?: boolean;
  variant?: "brief" | "system" | "app";
  /** Keyboard shortcut digit (1-9). Shown subtly in the tooltip. */
  shortcut?: number;
}

interface Props {
  briefCount: number;
  unreadMail: number;
  hasNextEvent: boolean;
  todayTasksCount: number;
  pendingRecsCount: number;
  onLauncher: () => void;
  onOpenBrief: () => void;
  onNavigateMail: () => void;
  onNavigateCalendar: () => void;
  onNavigateTasks: () => void;
  onNavigateHome: () => void;
  onOpenSettings: () => void;
  onNewTopic: () => void;
}

export function Dock({
  briefCount,
  unreadMail,
  hasNextEvent,
  todayTasksCount,
  pendingRecsCount,
  onLauncher,
  onOpenBrief,
  onNavigateMail,
  onNavigateCalendar,
  onNavigateTasks,
  onNavigateHome,
  onOpenSettings,
  onNewTopic,
}: Props) {
  const launcher: DockItem = {
    id: "launcher",
    label: "Launcher",
    glyph: <span className="dt-dock-grid-glyph" aria-hidden>▦</span>,
    onClick: onLauncher,
    variant: "system",
  };

  const brief: DockItem = {
    id: "brief",
    label: "AI Brief",
    glyph: <span className="dt-dock-brief-orb" aria-hidden />,
    onClick: onOpenBrief,
    badge: briefCount > 0 ? briefCount : undefined,
    variant: "brief",
  };

  const apps: DockItem[] = [
    {
      id: "mail",
      label: "邮件" + (unreadMail > 0 ? ` · ${unreadMail} 未读` : ""),
      glyph: "✉",
      onClick: onNavigateMail,
      variant: "app",
      shortcut: 1,
      badge: unreadMail > 0 ? unreadMail : undefined,
      hasActivity: unreadMail > 0,
    },
    {
      id: "calendar",
      label: "日历" + (hasNextEvent ? " · 有日程" : ""),
      glyph: "📅",
      onClick: onNavigateCalendar,
      variant: "app",
      shortcut: 2,
      hasActivity: hasNextEvent,
    },
    {
      id: "tasks",
      label: "待办" + (todayTasksCount > 0 ? ` · ${todayTasksCount} 件` : ""),
      glyph: "✓",
      onClick: onNavigateTasks,
      variant: "app",
      shortcut: 3,
      badge: todayTasksCount > 0 ? todayTasksCount : undefined,
      hasActivity: todayTasksCount > 0,
    },
    {
      id: "salmon",
      label: "Salmon" + (pendingRecsCount > 0 ? ` · ${pendingRecsCount} 条建议` : ""),
      glyph: "🐟",
      onClick: onNavigateHome,
      variant: "app",
      shortcut: 4,
      hasActivity: pendingRecsCount > 0,
    },
    { id: "new", label: "新建 Topic", glyph: "+", onClick: onNewTopic, variant: "app", shortcut: 5 },
  ];

  const system: DockItem[] = [
    { id: "settings", label: "设置", glyph: "⚙", onClick: onOpenSettings, variant: "system", shortcut: 9 },
  ];

  return (
    <div className="dt-dock" role="toolbar" aria-label="Salmon Desktop dock">
      <DockGroup items={[launcher]} />
      <DockGroup items={[brief]} highlight />
      <DockGroup items={apps} />
      <DockGroup items={system} />
    </div>
  );
}

function DockGroup({ items, highlight }: { items: DockItem[]; highlight?: boolean }) {
  return (
    <div className={`dt-dock-group${highlight ? " dt-dock-group-highlight" : ""}`}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`dt-dock-item dt-dock-item-${it.variant ?? "app"}${it.hasActivity ? " dt-dock-item-active" : ""}`}
          onClick={it.onClick}
          title={it.shortcut ? `${it.label} · Super+${it.shortcut}` : it.label}
          aria-label={it.label}
        >
          <span className="dt-dock-item-glyph">{it.glyph}</span>
          {typeof it.badge === "number" && (
            <span className="dt-dock-item-badge">{it.badge}</span>
          )}
          {it.hasActivity && !it.badge && <span className="dt-dock-item-dot" aria-hidden />}
        </button>
      ))}
    </div>
  );
}
