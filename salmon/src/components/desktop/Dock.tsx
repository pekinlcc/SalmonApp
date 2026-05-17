// Bottom dock — three sections: launcher trigger | Brief icon | app shortcuts.
// In Phase 1 every click just switches the existing top-level view; Phase 2
// will swap these for separate Tauri windows so a real GNOME taskbar shows
// "Salmon Mail" / "Salmon Calendar" as distinct apps.
import type { ReactNode } from "react";

interface DockItem {
  id: string;
  label: string;
  glyph: ReactNode;
  onClick: () => void;
  badge?: number;
  variant?: "brief" | "system" | "app";
}

interface Props {
  briefCount: number;
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
    { id: "mail",     label: "邮件",   glyph: "✉",  onClick: onNavigateMail,     variant: "app" },
    { id: "calendar", label: "日历",   glyph: "📅", onClick: onNavigateCalendar, variant: "app" },
    { id: "tasks",    label: "待办",   glyph: "✓",  onClick: onNavigateTasks,    variant: "app" },
    { id: "salmon",   label: "Salmon", glyph: "🐟", onClick: onNavigateHome,     variant: "app" },
    { id: "new",      label: "新建 Topic", glyph: "+", onClick: onNewTopic,       variant: "app" },
  ];

  const system: DockItem[] = [
    { id: "settings", label: "设置",   glyph: "⚙",  onClick: onOpenSettings,     variant: "system" },
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
          className={`dt-dock-item dt-dock-item-${it.variant ?? "app"}`}
          onClick={it.onClick}
          title={it.label}
          aria-label={it.label}
        >
          <span className="dt-dock-item-glyph">{it.glyph}</span>
          {typeof it.badge === "number" && (
            <span className="dt-dock-item-badge">{it.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
