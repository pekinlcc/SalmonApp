// GNOME-style Activities Overview — the canonical "press Super, see
// everything" surface. Triggered by the topbar Activities button (and
// Super+A). Composes three sections that already exist as concepts in
// the shell, but were previously scattered: workspace selector at the
// top, open-window cards in the middle, search box at the bottom that
// hands off to the launcher.
//
// Real per-window thumbnails would require a wlroots screencopy
// pipeline; for now we render colored "app cards" using the same
// gradient palette the dock uses, which keeps everything visually
// consistent while still letting the user see *which* window is which.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icons } from "./Icons";

export interface ActivitiesWindow {
  key: string;
  kind: "salmon" | "external";
  label?: string;
  appId?: string;
  title: string;
  ambiguous?: boolean;
}

export interface ActivitiesWorkspace {
  index: number;
  name: string;
  active: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  windows: ActivitiesWindow[];
  onFocusWindow: (w: ActivitiesWindow) => void;
  onCloseWindow?: (w: ActivitiesWindow) => void;
  workspaces: ActivitiesWorkspace[];
  onSwitchWorkspace: (index: number) => void;
  onSearch: (query: string) => void;
}

// Map a window to a dock-palette class so the same Mail window looks
// like Mail across the dock, window strip, and overview.
export function paletteForWindow(w: ActivitiesWindow): string {
  const hay = `${w.label ?? ""} ${w.appId ?? ""} ${w.title}`.toLowerCase();
  if (w.label === "salmon-mail" || /mail|gmail|thunderbird|outlook/.test(hay)) return "bg-mail";
  if (w.label === "salmon-calendar" || /calendar|日历/.test(hay)) return "bg-cal";
  if (w.label === "salmon-tasks" || /task|todo|待办/.test(hay)) return "bg-todo";
  if (w.label === "salmon-home" || w.label === "salmon-app") return "bg-salmon";
  if (w.label === "salmon-settings" || /settings|preferences|control/.test(hay)) return "bg-set";
  if (/files|nautilus|file-manager|文件/.test(hay)) return "bg-files";
  if (/firefox|chrom|brave|browser|safari|navigat/.test(hay)) return "bg-chrome";
  if (/term|console|kitty|alacritty|foot/.test(hay)) return "bg-term";
  return "bg-launcher";
}

export function GlyphForWindow({ w }: { w: ActivitiesWindow }) {
  const hay = `${w.label ?? ""} ${w.appId ?? ""} ${w.title}`.toLowerCase();
  if (w.label === "salmon-mail" || /mail|gmail|thunderbird|outlook/.test(hay)) return <Icons.Mail />;
  if (w.label === "salmon-calendar" || /calendar|日历/.test(hay)) return <Icons.Calendar />;
  if (w.label === "salmon-tasks" || /task|todo|待办/.test(hay)) return <Icons.CheckSquare />;
  if (w.label === "salmon-home" || w.label === "salmon-app") return <Icons.Salmon />;
  if (w.label === "salmon-settings" || /settings|preferences|control/.test(hay)) return <Icons.Settings />;
  if (/files|nautilus|file-manager|文件/.test(hay)) return <Icons.Folder />;
  if (/firefox|chrom|brave|browser|safari|navigat/.test(hay)) return <Icons.Browser />;
  if (/term|console|kitty|alacritty|foot/.test(hay)) return <Icons.Terminal />;
  return <Icons.Grid />;
}

export function ActivitiesOverview({
  open,
  onClose,
  windows,
  onFocusWindow,
  onCloseWindow,
  workspaces,
  onSwitchWorkspace,
  onSearch,
}: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset search and focus input each time the overlay opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  // Esc closes the overview — this fires before the window switcher's
  // own Esc handler because the overview overlay sits in front.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submitSearch = useCallback(() => {
    const q = query.trim();
    onClose();
    onSearch(q);
  }, [query, onClose, onSearch]);

  if (!open) return null;

  return (
    <div className="activities-overview" onClick={onClose}>
      <div className="ao-stage" onClick={(e) => e.stopPropagation()}>
        {/* Workspace selector strip */}
        {workspaces.length > 0 && (
          <div className="ao-workspaces" aria-label="Workspaces">
            {workspaces.map((ws) => (
              <button
                key={ws.index}
                type="button"
                className={`ao-workspace${ws.active ? " is-active" : ""}`}
                onClick={() => onSwitchWorkspace(ws.index)}
              >
                <span className="ao-ws-thumb" />
                <span className="ao-ws-name">{ws.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Window grid */}
        {windows.length === 0 ? (
          <div className="ao-empty">
            <Icons.Grid />
            <div>没有打开的窗口</div>
            <div className="ao-empty-sub">按 <span className="kbd">Super</span> 浏览所有应用</div>
          </div>
        ) : (
          <div className="ao-windows" aria-label="Open windows">
            {windows.map((w) => {
              const palette = paletteForWindow(w);
              return (
                <div key={w.key} className={`ao-window-card ${palette}`}>
                  <button
                    type="button"
                    className="ao-window-body"
                    onClick={() => { onClose(); onFocusWindow(w); }}
                    title={w.title}
                  >
                    <span className="ao-window-glyph">
                      <GlyphForWindow w={w} />
                    </span>
                    <span className="ao-window-meta">
                      <span className="ao-window-title">{w.title}</span>
                      <span className="ao-window-sub">
                        {w.kind === "salmon" ? "Salmon" : (w.appId || "外部应用")}
                        {w.ambiguous ? " · 多窗口" : ""}
                      </span>
                    </span>
                  </button>
                  {onCloseWindow && !w.ambiguous && (
                    <button
                      type="button"
                      className="ao-window-close"
                      onClick={(e) => { e.stopPropagation(); onCloseWindow(w); }}
                      title="关闭"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Search bar — hands off to launcher */}
        <form
          className="ao-search"
          onSubmit={(e) => { e.preventDefault(); submitSearch(); }}
        >
          <Icons.Search />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索应用、文件、AI 操作…"
            spellCheck={false}
          />
          <span className="kbd">Enter</span>
        </form>

        <div className="ao-hint">
          按 <span className="kbd">Esc</span> 返回桌面 · 按 <span className="kbd">Super</span> 打开应用列表
        </div>
      </div>
    </div>
  );
}
