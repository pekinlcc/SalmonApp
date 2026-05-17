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
  onLauncher: () => void;
  onNavigateMail: () => void;
  onNavigateCalendar: () => void;
  onNavigateTasks: () => void;
  onNavigateHome: () => void;
  onOpenSettings: () => void;
}

export function Dock({
  aiTile,
  unreadMail,
  hasNextEvent,
  todayTasksCount,
  onLauncher,
  onNavigateMail,
  onNavigateCalendar,
  onNavigateTasks,
  onNavigateHome,
  onOpenSettings,
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
          running={unreadMail > 0}
          onClick={onNavigateMail}
        >
          <Icons.Mail />
        </DockIcon>
        <DockIcon
          tip="日历 · Calendar"
          bg="bg-cal"
          running={hasNextEvent}
          onClick={onNavigateCalendar}
        >
          <Icons.Calendar />
        </DockIcon>
        <DockIcon
          tip="待办 · Tasks"
          bg="bg-todo"
          badge={todayTasksCount > 0 ? todayTasksCount : undefined}
          badgeKind="blue"
          onClick={onNavigateTasks}
        >
          <Icons.CheckSquare />
        </DockIcon>
        <DockIcon tip="SalmonApp" bg="bg-salmon" running={true} onClick={onNavigateHome}>
          <Icons.Salmon />
        </DockIcon>

        <div className="dock-sep" />

        <DockIcon tip="Files" bg="bg-files">
          <Icons.Folder />
        </DockIcon>
        <DockIcon tip="Firefox" bg="bg-chrome">
          <Icons.Browser />
        </DockIcon>
        <DockIcon tip="Terminal" bg="bg-term">
          <Icons.Terminal />
        </DockIcon>
        <DockIcon tip="Settings" bg="bg-set" onClick={onOpenSettings}>
          <Icons.Settings />
        </DockIcon>

        <div className="dock-sep" />

        <DockIcon tip="Show Applications" bg="bg-launcher" onClick={onLauncher}>
          <Icons.Grid />
        </DockIcon>
      </div>
    </div>
  );
}
