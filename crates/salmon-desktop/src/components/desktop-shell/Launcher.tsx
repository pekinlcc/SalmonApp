// GNOME-Activities-style launcher overlay: search input + app grid.
// Esc / click-out closes. Search launches matching desktop apps first and
// falls back to Salmon's global search when there is no app match.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { Icons } from "./Icons";

interface AppEntry {
  id: string;
  name: string;
  bg: string;
  icon: (props: { width?: number; height?: number }) => JSX.Element;
  onClick?: () => void;
}

interface InstalledApp {
  id: string;
  name: string;
  iconDataUrl: string | null;
  comment: string | null;
}

interface Props {
  onClose: () => void;
  onNavigateMail: () => void;
  onNavigateCalendar: () => void;
  onNavigateTasks: () => void;
  onNavigateHome: () => void;
  onNavigateContacts: () => void;
  onNewTopic: () => void;
  onOpenSearch: (q?: string) => void;
  onOpenSettings: () => void;
  onLaunchTerminal: () => void;
  onLaunchFiles: () => void;
  onLaunchBrowser: () => void;
}

export function Launcher(props: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [installed, setInstalled] = useState<InstalledApp[]>([]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  // Pull the freedesktop app list once per open. Cheap (~50ms on a fresh
  // Ubuntu install) and the results change rarely enough that we don't
  // bother caching across launcher invocations.
  useEffect(() => {
    let cancelled = false;
    api.listDesktopApps()
      .then((apps) => { if (!cancelled) setInstalled(apps); })
      .catch(() => { /* command absent on non-Linux: silently keep empty */ });
    return () => { cancelled = true; };
  }, []);

  const close = (after?: () => void) => {
    props.onClose();
    after?.();
  };

  const apps: AppEntry[] = [
    { id: "salmon",   name: "SalmonApp",     bg: "bg-salmon",   icon: Icons.Salmon,       onClick: () => close(props.onNavigateHome) },
    { id: "ai",       name: "Salmon Brief",  bg: "bg-ai",       icon: Icons.AIStar,       onClick: () => close(props.onNavigateHome) },
    { id: "mail",     name: "邮件",          bg: "bg-mail",     icon: Icons.Mail,         onClick: () => close(props.onNavigateMail) },
    { id: "calendar", name: "日历",          bg: "bg-cal",      icon: Icons.Calendar,     onClick: () => close(props.onNavigateCalendar) },
    { id: "tasks",    name: "待办",          bg: "bg-todo",     icon: Icons.CheckSquare,  onClick: () => close(props.onNavigateTasks) },
    { id: "contacts", name: "联系人",        bg: "bg-set",      icon: Icons.Pin,          onClick: () => close(props.onNavigateContacts) },
    { id: "new",      name: "新 Topic",      bg: "bg-files",    icon: Icons.Doc,          onClick: () => close(props.onNewTopic) },
    { id: "settings", name: "设置",          bg: "bg-set",      icon: Icons.Settings,     onClick: () => close(props.onOpenSettings) },
    { id: "files",    name: "Files",         bg: "bg-files",    icon: Icons.Folder,       onClick: () => close(props.onLaunchFiles) },
    { id: "browser",  name: "Browser",       bg: "bg-chrome",   icon: Icons.Browser,      onClick: () => close(props.onLaunchBrowser) },
    { id: "terminal", name: "Terminal",      bg: "bg-term",     icon: Icons.Terminal,     onClick: () => close(props.onLaunchTerminal) },
    { id: "search",   name: "搜索",          bg: "bg-launcher", icon: Icons.Search,       onClick: () => close(() => props.onOpenSearch(query)) },
  ];

  // Live-filter both Salmon's built-in tiles and the user's installed apps
  // by the search box. Empty query → show everything.
  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => a.name.toLowerCase().includes(q));
  }, [apps, query]);
  const filteredInstalled = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return installed;
    return installed.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.comment ?? "").toLowerCase().includes(q),
    );
  }, [installed, query]);

  const activateSearch = () => {
    const q = query.trim();
    if (q) {
      const builtin = filteredApps.find((a) => a.onClick);
      if (builtin?.onClick) {
        builtin.onClick();
        return;
      }
      const osApp = filteredInstalled[0];
      if (osApp) {
        close(() => {
          api.launchDesktopApp(osApp.id).catch((err) => {
            // eslint-disable-next-line no-console
            console.error(`launch ${osApp.id}:`, err);
          });
        });
        return;
      }
    }
    close(() => props.onOpenSearch(q));
  };

  return (
    <div className="launcher" onClick={() => props.onClose()}>
      <div className="launcher-search" onClick={(e) => e.stopPropagation()}>
        <Icons.Search />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") activateSearch();
          }}
          placeholder="搜索应用、文件、AI 操作…"
        />
        <span className="kbd" style={{ padding: "2px 6px" }}>Esc</span>
      </div>

      <div
        className="launcher-grid"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {filteredApps.map((a) => {
          const Icon = a.icon;
          return (
            <div key={a.id} className="launcher-tile" onClick={a.onClick}>
              <div className={`icon ${a.bg}`}>
                <Icon />
              </div>
              <div className="lbl">{a.name}</div>
            </div>
          );
        })}
        {filteredInstalled.map((a) => (
          <div
            key={`os:${a.id}`}
            className="launcher-tile"
            title={a.comment ?? a.name}
            onClick={() =>
              close(() => {
                api.launchDesktopApp(a.id).catch((err) => {
                  // eslint-disable-next-line no-console
                  console.error(`launch ${a.id}:`, err);
                });
              })
            }
          >
            <div className="icon icon-installed">
              {a.iconDataUrl ? (
                <img src={a.iconDataUrl} alt="" />
              ) : (
                <span className="installed-fallback">{a.name.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="lbl">{a.name}</div>
          </div>
        ))}
      </div>

      <div className="launcher-pages">
        <span className="pip --on" />
        <span className="pip" />
        <span className="pip" />
      </div>
    </div>
  );
}
