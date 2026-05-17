// GNOME-Activities-style launcher overlay: search input + 7-column app grid +
// pager pips. Esc / click-out closes. The search box currently just routes the
// query into the existing global search modal — wiring more app verbs is the
// design's next phase.
import { useEffect, useRef, useState } from "react";
import { Icons } from "./Icons";

interface AppEntry {
  id: string;
  name: string;
  bg: string;
  icon: (props: { width?: number; height?: number }) => JSX.Element;
  onClick?: () => void;
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
}

export function Launcher(props: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

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
    { id: "files",    name: "Files",         bg: "bg-files",    icon: Icons.Folder },
    { id: "firefox",  name: "Firefox",       bg: "bg-chrome",   icon: Icons.Browser },
    { id: "terminal", name: "Terminal",      bg: "bg-term",     icon: Icons.Terminal },
    { id: "meet",     name: "Meet",          bg: "bg-cal",      icon: Icons.Video },
    { id: "notes",    name: "Notes",         bg: "bg-files",    icon: Icons.Doc },
    { id: "search",   name: "搜索",          bg: "bg-launcher", icon: Icons.Search,       onClick: () => close(() => props.onOpenSearch(query)) },
  ];

  return (
    <div className="launcher" onClick={() => props.onClose()}>
      <div className="launcher-search" onClick={(e) => e.stopPropagation()}>
        <Icons.Search />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") close(() => props.onOpenSearch(query));
          }}
          placeholder="搜索应用、文件、AI 操作…"
        />
        <span className="kbd" style={{ padding: "2px 6px" }}>Esc</span>
      </div>

      <div className="launcher-grid" onClick={(e) => e.stopPropagation()}>
        {apps.map((a) => {
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
      </div>

      <div className="launcher-pages">
        <span className="pip --on" />
        <span className="pip" />
        <span className="pip" />
      </div>
    </div>
  );
}
