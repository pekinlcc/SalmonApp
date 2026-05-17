// GNOME-style minimal top bar for the desktop shell.
//   left:   Activities label → opens launcher
//   center: Date + clock, with Brief item count badge
//   right:  Tray icons (placeholders for net/audio/battery) + wallpaper
//           cycle button + exit-desktop button.
import { useEffect, useState } from "react";
import { WALLPAPER_VARIANTS, type WallpaperVariant } from "./Wallpaper";

interface Props {
  briefCount: number;
  wallpaper: WallpaperVariant;
  onActivities: () => void;
  onCycleWallpaper: () => void;
  onExitDesktop: () => void;
}

function tick(): { time: string; date: string } {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return { time: `${hh}:${mm}`, date: md };
}

export function DesktopTopBar({
  briefCount,
  wallpaper,
  onActivities,
  onCycleWallpaper,
  onExitDesktop,
}: Props) {
  const [{ time, date }, setNow] = useState(tick);
  useEffect(() => {
    const t = window.setInterval(() => setNow(tick()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const currentLabel = WALLPAPER_VARIANTS.find((v) => v.id === wallpaper)?.label ?? wallpaper;

  return (
    <div className="dt-topbar" role="banner">
      <button
        type="button"
        className="dt-topbar-activities"
        onClick={onActivities}
        title="Activities · 打开 launcher · 快捷键 Super"
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
          className="dt-tray-wallpaper"
          onClick={onCycleWallpaper}
          title={`切换壁纸 · 当前: ${currentLabel}`}
          aria-label={`切换壁纸（当前 ${currentLabel}）`}
        >
          ◐
        </button>
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
