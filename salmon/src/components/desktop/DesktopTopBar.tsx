// GNOME-style minimal top bar for the desktop shell. Centred clock + date,
// system tray on the right (placeholder icons), Activities label on the left
// that opens the launcher.
import { useEffect, useState } from "react";

interface Props {
  briefCount: number;
  onActivities: () => void;
  onExitDesktop: () => void;
}

function tick(): { time: string; date: string } {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return { time: `${hh}:${mm}`, date: md };
}

export function DesktopTopBar({ briefCount, onActivities, onExitDesktop }: Props) {
  const [{ time, date }, setNow] = useState(tick);
  useEffect(() => {
    const t = window.setInterval(() => setNow(tick()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="dt-topbar" role="banner">
      <button
        type="button"
        className="dt-topbar-activities"
        onClick={onActivities}
        title="Activities · 打开 launcher"
      >
        Activities
      </button>

      <button
        type="button"
        className="dt-topbar-clock"
        onClick={onActivities}
        title={`${date} · ${time}`}
      >
        <span className="dt-clock-date">{date}</span>
        <span className="dt-clock-time">{time}</span>
        {briefCount > 0 && (
          <span className="dt-clock-badge" aria-label={`${briefCount} 条 Brief`}>
            {briefCount}
          </span>
        )}
      </button>

      <div className="dt-topbar-tray">
        <span className="dt-tray-ico" title="网络">↑↓</span>
        <span className="dt-tray-ico" title="音量">♪</span>
        <span className="dt-tray-ico" title="电量">100%</span>
        <button
          type="button"
          className="dt-tray-exit"
          onClick={onExitDesktop}
          title="退出桌面模式 · 回到 Salmon 应用视图"
        >
          ⤢
        </button>
      </div>
    </div>
  );
}
