// Top-level Ubuntu-style desktop shell. Pulled in from App.tsx when
// `topView === "desktop"`. On Linux this is the default first-launch view;
// elsewhere it's behind a Settings toggle.
//
// Phase 1 (current): single-window — clicking a dock app calls back into
// App.tsx to setTopView, which falls through to the existing MailView /
// CalendarView / etc. The desktop "yields" to the normal layout.
//
// Phase 2 (future): each dock app will open as a separate Tauri window;
// shell stays mounted in the background.
//
// Phase 3 (future): replaces GNOME Shell entirely — see
// docs/phase3-compositor/ for the implementation plan.
import { useCallback, useEffect, useState } from "react";
import { Wallpaper, WALLPAPER_VARIANTS, type WallpaperVariant } from "./Wallpaper";
import { DesktopTopBar } from "./DesktopTopBar";
import { BriefWidget } from "./BriefWidget";
import { Dock } from "./Dock";
import { Launcher } from "./Launcher";
import { useDesktopBrief, briefItemCount } from "../../lib/useDesktopBrief";

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
  /** Switch back to the previous in-app view (typically "home"). */
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
  const [briefMode, setBriefMode] = useState<"auto" | "open">("auto");
  const [wallpaper, setWallpaper] = useState<WallpaperVariant>(loadWallpaper);
  const count = briefItemCount(brief);

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

  // Map the dock's digit shortcuts (Super+1..9) to handlers, in the same
  // order the dock visually shows them. Mirrors the keyboard layout so the
  // tooltip's "Super+N" hint matches reality.
  const shortcutHandlers: Record<number, () => void> = {
    1: props.onNavigateMail,
    2: props.onNavigateCalendar,
    3: props.onNavigateTasks,
    4: props.onNavigateHome,
    5: props.onNewTopic,
    9: props.onOpenSettings,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Super (Meta) by itself toggles the launcher — matches GNOME +
      // the prototype's app.jsx behaviour. We only fire on keydown to
      // avoid double-triggering, and only when no other modifier is held.
      if ((e.key === "Meta" || e.key === "OS") && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        setLauncherOpen((v) => !v);
        return;
      }
      // Super+1..9 → launch the Nth dock item. Ignore plain 1..9 so
      // typing in any text field still works.
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
    // shortcutHandlers is rebuilt every render but only the function
    // identities (props) ever change — re-binding on each render is cheap
    // and avoids stale references.
  });

  return (
    <div className="dt-shell" data-mode="desktop">
      <Wallpaper variant={wallpaper} />

      <DesktopTopBar
        briefCount={count}
        wallpaper={wallpaper}
        onActivities={() => setLauncherOpen(true)}
        onCycleWallpaper={cycleWallpaper}
        onExitDesktop={props.onExitDesktop}
      />

      <div className="dt-stage">
        <BriefWidget
          // remount when user clicks dock brief icon — resets to overview
          key={briefMode === "open" ? "open" : "auto"}
          snap={brief}
          onNavigateMail={() => props.onNavigateMail()}
          onNavigateCalendar={() => props.onNavigateCalendar()}
          onNavigateTasks={() => props.onNavigateTasks()}
          onNavigateHome={() => props.onNavigateHome()}
        />
      </div>

      <Dock
        briefCount={count}
        unreadMail={brief.unreadMail}
        hasNextEvent={brief.nextEvent !== null}
        todayTasksCount={brief.todayTasks.length}
        pendingRecsCount={brief.recs.length}
        onLauncher={() => setLauncherOpen(true)}
        onOpenBrief={() => setBriefMode((m) => (m === "open" ? "auto" : "open"))}
        onNavigateMail={props.onNavigateMail}
        onNavigateCalendar={props.onNavigateCalendar}
        onNavigateTasks={props.onNavigateTasks}
        onNavigateHome={props.onNavigateHome}
        onOpenSettings={props.onOpenSettings}
        onNewTopic={props.onNewTopic}
      />

      {launcherOpen && (
        <Launcher
          onClose={() => setLauncherOpen(false)}
          onNavigateMail={props.onNavigateMail}
          onNavigateCalendar={props.onNavigateCalendar}
          onNavigateTasks={props.onNavigateTasks}
          onNavigateHome={props.onNavigateHome}
          onNavigateContacts={props.onNavigateContacts}
          onNewTopic={props.onNewTopic}
          onOpenSearch={props.onOpenSearch}
          onOpenSettings={props.onOpenSettings}
        />
      )}
    </div>
  );
}
