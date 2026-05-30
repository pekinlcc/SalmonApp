// Slim in-app titlebar used by Mail / Calendar / Tasks / Contacts / Settings
// when those views run as their own per-app Tauri window (spawned by the
// SalmonApp Desktop shell). The compositor's CSD/SSD story under labwc and
// GNOME's Wayland session is inconsistent for webkit2gtk windows — some
// machines get no close/minimize buttons at all. Drawing our own bar
// removes that dependency: the buttons here drive getCurrentWindow()
// directly via tauri-plugin-window so the user can always escape.
//
// The bar is also a drag handle (data-tauri-drag-region) so users can
// reposition the window when the WM hasn't given them a server-side one.
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  title: string;
}

export function AppWindowTitleBar({ title }: Props) {
  const w = getCurrentWindow();
  const onMinimize = () => { w.minimize().catch(() => {}); };
  const onMaximize = async () => {
    try {
      const maxed = await w.isMaximized();
      if (maxed) await w.unmaximize();
      else await w.maximize();
    } catch {}
  };
  const onClose = () => { w.close().catch(() => {}); };

  return (
    <div className="app-titlebar" data-tauri-drag-region>
      <div className="app-titlebar-title" data-tauri-drag-region>{title}</div>
      <div className="app-titlebar-btns">
        <button
          className="app-titlebar-btn"
          aria-label="最小化"
          onClick={onMinimize}
          title="最小化"
        >
          <svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <button
          className="app-titlebar-btn"
          aria-label="最大化"
          onClick={onMaximize}
          title="最大化 / 还原"
        >
          <svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button
          className="app-titlebar-btn app-titlebar-btn-close"
          aria-label="关闭"
          onClick={onClose}
          title="关闭"
        >
          <svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
