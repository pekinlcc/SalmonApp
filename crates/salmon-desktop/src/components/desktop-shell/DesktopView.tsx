// Top-level Ubuntu Desktop shell — v2 high-fidelity port.
//
// Mounted by App.tsx when `topView === "desktop"`. On Linux this is the
// default first-launch view; on Mac/Windows it's hidden in Settings.
//
// Centralized orchestration that the design's app.jsx kept inline:
//   - aiOpen / aiHover state for the AI Live Tile interactions
//   - showCenterWidget = !aiOpen && !aiHover  (so we never show two
//     copies of the same brief at once)
//   - widgetMode that the dock popovers can mutate
//
// Data comes from useDesktopBrief — real Tauri commands hitting SQLite.
import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./desktop.css";
import { Wallpaper, WALLPAPER_VARIANTS, type WallpaperVariant } from "./Wallpaper";
import { TopBar } from "./TopBar";
import { Widget, type WidgetMode, type WidgetCallbacks } from "./Widget";
import { Dock } from "./Dock";
import { Launcher } from "./Launcher";
import { AILiveTile } from "./AILiveTile";
import { AIPeek } from "./AIPeek";
import { AIPopover } from "./AIPopover";
import { useDesktopBrief, briefItemCount } from "../../lib/useDesktopBrief";
import { isShellWindow, openAppWindow } from "../../lib/openAppWindow";

const WALLPAPER_STORAGE_KEY = "salmon.desktop.wallpaper";

function loadWallpaper(): WallpaperVariant {
  try {
    const saved = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (saved && WALLPAPER_VARIANTS.some((v) => v.id === saved)) {
      return saved as WallpaperVariant;
    }
  } catch {}
  return "aurora";
}

interface Props {
  onExitDesktop: () => void;
  onNavigateHome: () => void;
  onNavigateMail: () => void;
  onNavigateCalendar: () => void;
  onNavigateTasks: () => void;
  onNavigateContacts: () => void;
  onNewTopic: () => void;
  onOpenSearch: (q?: string) => void;
  onOpenSettings: () => void;
}

export function DesktopView(props: Props) {
  const brief = useDesktopBrief(true);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHover, setAiHover] = useState(false);
  const [wallpaper, setWallpaper] = useState<WallpaperVariant>(loadWallpaper);
  const count = briefItemCount(brief);

  // GNOME/Wayland often ignores Tauri's startup `fullscreen: true` hint
  // because GTK's fullscreen request races the X/Wayland window-mapping
  // step. Force it at runtime once React mounts — and provide F11 to
  // toggle in case the user wants to peek at GNOME without quitting.
  useEffect(() => {
    const w = getCurrentWindow();
    if (w.label !== "shell") return;
    // Tiny delay lets the window finish mapping before we re-issue the
    // hint; without it the request sometimes lands before GTK's realize
    // step and gets silently dropped.
    const t = setTimeout(() => { w.setFullscreen(true).catch(() => {}); }, 80);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F11") return;
      e.preventDefault();
      const w = getCurrentWindow();
      w.isFullscreen().then((cur) => { w.setFullscreen(!cur).catch(() => {}); });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto widget mode: idle (no items) → collapsed (1 item) → overview (2+).
  // The user can override by clicking action buttons inside the widget.
  const [manualMode, setManualMode] = useState<WidgetMode | null>(null);
  const autoMode: WidgetMode = count === 0 ? "idle" : count === 1 ? "collapsed" : "overview";
  const widgetMode: WidgetMode = manualMode ?? autoMode;
  // Reset manual override whenever the data shape changes class so the
  // widget re-adapts to new conditions instead of being stuck in a stale
  // pose (e.g. user collapses → mail arrives → should re-open).
  useEffect(() => {
    setManualMode(null);
  }, [autoMode]);

  // Hide the center widget when the AI tile is showing peek/popover — they
  // would otherwise overlap and confuse the user. (Matches design app.jsx.)
  const showCenterWidget = !aiOpen && !aiHover;

  const cycleWallpaper = useCallback(() => {
    setWallpaper((cur) => {
      const i = WALLPAPER_VARIANTS.findIndex((v) => v.id === cur);
      const next = WALLPAPER_VARIANTS[(i + 1) % WALLPAPER_VARIANTS.length].id;
      try {
        localStorage.setItem(WALLPAPER_STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  // When running as the SalmonApp Desktop shell (Tauri window labeled
  // "shell"), every "open Mail / Calendar / ..." action spawns a separate
  // OS-level Tauri window instead of switching the shell's own view. This
  // makes the desktop feel like a real shell — apps are independent
  // windows you can move/close/minimize. In the SalmonApp App binary the
  // dock falls back to in-app navigation (no new windows).
  const shellMode = isShellWindow();
  const navigate = {
    mail: shellMode ? () => openAppWindow("mail") : props.onNavigateMail,
    calendar: shellMode ? () => openAppWindow("calendar") : props.onNavigateCalendar,
    tasks: shellMode ? () => openAppWindow("tasks") : props.onNavigateTasks,
    home: shellMode ? () => openAppWindow("home") : props.onNavigateHome,
    contacts: shellMode ? () => openAppWindow("contacts") : props.onNavigateContacts,
    settings: shellMode ? () => openAppWindow("settings") : props.onOpenSettings,
  };

  // Super (Meta) toggles launcher. Super+1..9 hits dock shortcuts in the
  // same left-to-right order shown in the dock.
  const shortcutHandlers: Record<number, () => void> = {
    1: navigate.mail,
    2: navigate.calendar,
    3: navigate.tasks,
    4: navigate.home,
    9: navigate.settings,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Meta" || e.key === "OS") && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        setLauncherOpen((v) => !v);
        return;
      }
      if (e.metaKey && /^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key, 10);
        const handler = shortcutHandlers[n];
        if (handler) {
          e.preventDefault();
          handler();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const callbacks: WidgetCallbacks = {
    onNavigateMail: navigate.mail,
    onNavigateCalendar: navigate.calendar,
    onNavigateTasks: navigate.tasks,
    onNavigateHome: navigate.home,
  };

  const aiTile = (
    <AILiveTile
      snap={brief}
      callbacks={callbacks}
      badgeCount={count}
      onClick={(e) => {
        e.stopPropagation();
        setAiOpen((v) => !v);
        setAiHover(false);
      }}
      onHoverChange={(h) => setAiHover(h)}
      peek={<AIPeek show={aiHover && !aiOpen} snap={brief} callbacks={callbacks} />}
      pop={
        <AIPopover
          show={aiOpen}
          snap={brief}
          callbacks={callbacks}
          onClose={() => setAiOpen(false)}
          onExpand={() => {
            setAiOpen(false);
            setManualMode("expanded");
          }}
        />
      }
    />
  );

  // Cycle wallpaper from a keyboard shortcut hint — but we don't use this in
  // user-facing copy; keeps the function reference live for the topbar.
  void cycleWallpaper;

  return (
    <div className="dt-shell" data-mode="desktop">
      <Wallpaper variant={wallpaper} />

      <TopBar
        briefCount={count}
        onActivities={() => setLauncherOpen(true)}
        onExitDesktop={props.onExitDesktop}
      />

      <div
        className="stage"
        style={{
          opacity: showCenterWidget ? 1 : 0,
          transform: showCenterWidget ? "scale(1) translateY(0)" : "scale(0.97) translateY(8px)",
          transition:
            "opacity 200ms cubic-bezier(0.2,0.8,0.2,1), transform 240ms cubic-bezier(0.2,0.8,0.2,1)",
          pointerEvents: showCenterWidget ? "auto" : "none",
        }}
      >
        <Widget
          mode={widgetMode}
          snap={brief}
          onModeChange={(m) => setManualMode(m)}
          callbacks={callbacks}
        />
      </div>

      <Dock
        aiTile={aiTile}
        unreadMail={brief.unreadMail}
        hasNextEvent={brief.nextEvent !== null}
        todayTasksCount={brief.todayTasks.length}
        onLauncher={() => setLauncherOpen(true)}
        onNavigateMail={navigate.mail}
        onNavigateCalendar={navigate.calendar}
        onNavigateTasks={navigate.tasks}
        onNavigateHome={navigate.home}
        onOpenSettings={navigate.settings}
      />

      {launcherOpen && (
        <Launcher
          onClose={() => setLauncherOpen(false)}
          onNavigateMail={navigate.mail}
          onNavigateCalendar={navigate.calendar}
          onNavigateTasks={navigate.tasks}
          onNavigateHome={navigate.home}
          onNavigateContacts={navigate.contacts}
          onNewTopic={props.onNewTopic}
          onOpenSearch={props.onOpenSearch}
          onOpenSettings={navigate.settings}
        />
      )}
    </div>
  );
}
