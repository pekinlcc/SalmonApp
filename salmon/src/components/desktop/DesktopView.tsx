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
import { useState } from "react";
import { Wallpaper } from "./Wallpaper";
import { DesktopTopBar } from "./DesktopTopBar";
import { BriefWidget } from "./BriefWidget";
import { Dock } from "./Dock";
import { Launcher } from "./Launcher";
import { useDesktopBrief, briefItemCount } from "../../lib/useDesktopBrief";

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
  const count = briefItemCount(brief);

  return (
    <div className="dt-shell" data-mode="desktop">
      <Wallpaper />

      <DesktopTopBar
        briefCount={count}
        onActivities={() => setLauncherOpen(true)}
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
