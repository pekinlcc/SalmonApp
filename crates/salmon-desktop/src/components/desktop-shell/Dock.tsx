// Dock — from left:
//   AI Live Tile (heterogeneous) → separator → SalmonApp suite (Mail / Calendar
//   / Tasks / SalmonApp) → separator → OS apps (Files / Browser / Terminal /
//   Settings) → separator → Launcher (demoted, was front-and-center before).
//
// The hover/click logic for the AI tile is owned by the parent (DesktopView)
// so it can hide the center Widget when the popovers are showing.
import { ReactNode } from "react";
import { Icons } from "./Icons";

interface DockIconProps {
  tip: string;
  bg: string;
  badge?: ReactNode;
  badgeKind?: "blue" | "dot";
  running?: boolean;
  runningAccent?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

function DockIcon({ tip, bg, badge, badgeKind, running, runningAccent, onClick, children }: DockIconProps) {
  return (
    <div className={`dock-icon ${bg}`} onClick={onClick}>
      {children}
      {badge !== undefined && badge !== null && badge !== false && badge !== "" && (
        <span className={`dock-badge${badgeKind ? " --" + badgeKind : ""}`}>{badge}</span>
      )}
      {running && <span className={`dock-running${runningAccent ? " accent" : ""}`} />}
      <span className="dock-tip">{tip}</span>
    </div>
  );
}

interface Props {
  /** Slot for the AI Live Tile (parent owns it so it can wire hover/click). */
  aiTile: ReactNode;
  unreadMail: number;
  hasNextEvent: boolean;
  todayTasksCount: number;
  mailRunning: boolean;
  calendarRunning: boolean;
  tasksRunning: boolean;
  homeRunning: boolean;
  settingsRunning: boolean;
  filesRunning: boolean;
  browserRunning: boolean;
  terminalRunning: boolean;
  windowCount: number;
  onLauncher: () => void;
  onNavigateMail: () => void;
  onNavigateCalendar: () => void;
  onNavigateTasks: () => void;
  onNavigateHome: () => void;
  onOpenSettings: () => void;
  onLaunchTerminal: () => void;
  onLaunchFiles: () => void;
  onLaunchBrowser: () => void;
  onLaunchSystemSettings: () => void;
}

export function Dock({
  aiTile,
  unreadMail,
  hasNextEvent,
  todayTasksCount,
  mailRunning,
  calendarRunning,
  tasksRunning,
  homeRunning,
  settingsRunning,
  filesRunning,
  browserRunning,
  terminalRunning,
  windowCount,
  onLauncher,
  onNavigateMail,
  onNavigateCalendar,
  onNavigateTasks,
  onNavigateHome,
  onOpenSettings,
  onLaunchTerminal,
  onLaunchFiles,
  onLaunchBrowser,
  onLaunchSystemSettings,
}: Props) {
  return (
    <div className="dock-wrap">
      <div className="dock">
        {aiTile}

        <div className="dock-sep" />

        <DockIcon
          tip="邮件 · Mail"
          bg="bg-mail"
          badge={unreadMail > 0 ? (unreadMail > 99 ? "99+" : unreadMail) : undefined}
          running={mailRunning || unreadMail > 0}
          onClick={onNavigateMail}
        >
          <Icons.Mail />
        </DockIcon>
        <DockIcon
          tip="日历 · Calendar"
          bg="bg-cal"
          running={calendarRunning || hasNextEvent}
          onClick={onNavigateCalendar}
        >
          <Icons.Calendar />
        </DockIcon>
        <DockIcon
          tip="待办 · Tasks"
          bg="bg-todo"
          badge={todayTasksCount > 0 ? todayTasksCount : undefined}
          badgeKind="blue"
          running={tasksRunning}
          onClick={onNavigateTasks}
        >
          <Icons.CheckSquare />
        </DockIcon>
        <DockIcon tip="SalmonApp" bg="bg-salmon" running={homeRunning} onClick={onNavigateHome}>
          <Icons.Salmon />
        </DockIcon>

        <div className="dock-sep" />

        <DockIcon tip="Files" bg="bg-files" running={filesRunning} onClick={onLaunchFiles}>
          <Icons.Folder />
        </DockIcon>
        <DockIcon tip="Browser" bg="bg-chrome" running={browserRunning} onClick={onLaunchBrowser}>
          <Icons.Browser />
        </DockIcon>
        <DockIcon tip="Terminal" bg="bg-term" running={terminalRunning} onClick={onLaunchTerminal}>
          <Icons.Terminal />
        </DockIcon>
        <DockIcon tip="System Settings" bg="bg-set" running={settingsRunning} onClick={onLaunchSystemSettings}>
          <Icons.Settings />
        </DockIcon>

        <div className="dock-sep" />

        <DockIcon
          tip={windowCount > 0 ? `${windowCount} windows · Show Applications` : "Show Applications"}
          bg="bg-launcher"
          badge={windowCount > 0 ? windowCount : undefined}
          badgeKind="blue"
          onClick={onLauncher}
        >
          <Icons.Grid />
        </DockIcon>
      </div>
    </div>
  );
}
