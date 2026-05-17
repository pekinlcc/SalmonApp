// GNOME-Activities-style launcher overlay. Search + 4x2 app grid. The grid
// items are the same destinations as the dock — duplicate is intentional:
// the dock is always-visible, the launcher is the "I want to find something"
// path. Search is wired to existing global search (Mail / Topic / Contact).
import { useEffect, useRef, useState } from "react";

interface AppEntry {
  id: string;
  label: string;
  glyph: string;
  hue: string;
  onClick: () => void;
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

  const apps: AppEntry[] = [
    { id: "salmon",   label: "Salmon",   glyph: "🐟", hue: "var(--oc-blue)",  onClick: () => { props.onNavigateHome();     props.onClose(); } },
    { id: "mail",     label: "邮件",     glyph: "✉",  hue: "var(--green-7)",  onClick: () => { props.onNavigateMail();     props.onClose(); } },
    { id: "calendar", label: "日历",     glyph: "📅", hue: "var(--orange-7)", onClick: () => { props.onNavigateCalendar(); props.onClose(); } },
    { id: "tasks",    label: "待办",     glyph: "✓",  hue: "var(--teal-7)",   onClick: () => { props.onNavigateTasks();    props.onClose(); } },
    { id: "contacts", label: "联系人",   glyph: "👥", hue: "var(--purple-7)", onClick: () => { props.onNavigateContacts(); props.onClose(); } },
    { id: "new",      label: "新 Topic", glyph: "+",  hue: "var(--magenta-7)",onClick: () => { props.onNewTopic();         props.onClose(); } },
    { id: "settings", label: "设置",     glyph: "⚙",  hue: "var(--graphite-7)", onClick: () => { props.onOpenSettings();   props.onClose(); } },
    { id: "search",   label: "搜索",     glyph: "🔍", hue: "var(--blue-7)",   onClick: () => { props.onOpenSearch(query); props.onClose(); } },
  ];

  const filtered = query.trim()
    ? apps.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : apps;

  return (
    <div className="dt-launcher" role="dialog" aria-modal="true" onClick={props.onClose}>
      <div className="dt-launcher-inner" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="dt-launcher-search"
          placeholder="搜索应用 · 邮件 · 联系人…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Enter on text → fall through to global search (mail/topic/contact)
              if (query.trim()) {
                props.onOpenSearch(query);
                props.onClose();
              }
            }
          }}
        />

        <div className="dt-launcher-grid">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              className="dt-launcher-tile"
              onClick={a.onClick}
              style={{ ["--tile-hue" as any]: a.hue }}
            >
              <span className="dt-launcher-tile-glyph">{a.glyph}</span>
              <span className="dt-launcher-tile-label">{a.label}</span>
            </button>
          ))}
        </div>

        <div className="dt-launcher-hint">
          按 <kbd>Esc</kbd> 关闭 · <kbd>Enter</kbd> 搜索内容
        </div>
      </div>
    </div>
  );
}
