// GNOME-style top bar: Activities (left) · clock (center, with Brief badge) · tray (right).
// `briefCount` is the real number of pending Brief items from useDesktopBrief.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../../lib/api";
import { Icons } from "./Icons";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface Props {
  briefCount: number;
  onActivities: () => void;
  /** Exit the desktop shell back to the normal app home — kept so the
   *  user can always get back to WelcomeBack without a Settings hunt. */
  onExitDesktop?: () => void;
}

/** When the desktop binary is running as the labwc session shell
 *  (label="shell"), the exit button signs out of the Wayland session and
 *  returns to GDM — closing the window alone is not enough because
 *  labwc-config/autostart respawns salmonapp-desktop in a tight loop. In the
 *  App binary the desktop view is just a togglable in-app screen, so we fall
 *  back to the in-app switch via `onExitDesktop`. */
async function exitDesktopShell(fallback?: () => void) {
  try {
    const w = getCurrentWindow();
    if (w.label === "shell") {
      try {
        await api.signOutSession();
        return;
      } catch {
        // logind refused — fall through to close so the user isn't trapped.
      }
      try { await w.setFullscreen(false); } catch {}
      try { await w.close(); return; } catch {}
    }
  } catch {}
  fallback?.();
}

export function TopBar({ briefCount, onActivities, onExitDesktop }: Props) {
  const now = useClock();
  const wd = WEEKDAYS[now.getDay()];
  const date = `${now.getMonth() + 1}月${now.getDate()}日`;
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });

  return (
    <div className="topbar">
      <div className="tb-activities" title="Activities" onClick={onActivities}>
        <span className="dot" />
        <span>Activities</span>
      </div>

      <div className="tb-clock">
        <span>{wd}</span>
        <span>{date}</span>
        <span className="sep">·</span>
        <span>{time}</span>
        {briefCount > 0 && <span className="tb-badge" title={`${briefCount} briefings ready`}>{briefCount}</span>}
      </div>

      <div className="tb-tray">
        <button className="tb-btn" title="Notifications" type="button">
          <Icons.Bell />
        </button>
        <button className="tb-btn" title="Network" type="button">
          <Icons.Wifi />
        </button>
        <button className="tb-btn" title="Volume" type="button">
          <Icons.Volume />
        </button>
        <button className="tb-btn" title="Battery" type="button">
          <Icons.Battery />
        </button>
        <button
          className="tb-btn"
          title="退出会话 (Super+Shift+Q)"
          type="button"
          onClick={() => exitDesktopShell(onExitDesktop)}
        >
          <Icons.Close />
        </button>
      </div>
    </div>
  );
}
