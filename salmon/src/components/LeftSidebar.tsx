import { useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { CliInfo, Topic } from "../lib/types";
import { relativeTime } from "../lib/format";
import pkg from "../../package.json";

interface Props {
  topics: Topic[];
  selectedId: string | null;
  runningIds: Set<string>;
  spawningId: string | null;
  cliStatus: CliInfo[];
  /** v0.9.0-alpha.1: top-level view. 'home' is Welcome Back; 'mail' / 'calendar'
   *  are stub pages until the OAuth flow + sync land. */
  topView: "home" | "mail" | "calendar" | "tasks";
  onSelect: (id: string) => void;
  onHome: () => void;
  onOpenMail: () => void;
  onOpenCalendar: () => void;
  onOpenTasks: () => void;
  onNewTopic: () => void;
  onOpenSearch: (query?: string) => void;
  onOpenSettings: () => void;
  onDeleteTopic: (id: string) => void;
  onRequestRenameTopic: (id: string) => void;
  onArchiveTopic: (id: string, archived: boolean) => void;
}

export function LeftSidebar(props: Props) {
  const { topics, selectedId, runningIds, spawningId, cliStatus } = props;
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [showArchived, setShowArchived] = useState(false);

  // Close the per-topic context menu when the user clicks anywhere outside
  // the topic list. Without this it would only collapse on a menu action or
  // on right-clicking the same topic again.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      const root = listRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      setMenuFor(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuFor]);

  const { active, archived } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: Topic) => !q || t.title.toLowerCase().includes(q);
    // Sort by updatedAt DESC so the most-recently-active Topic always floats
    // to the top within its time bucket. The source `topics` array is only
    // sorted at app launch — subsequent setTopics(cur => cur.map(...)) calls
    // preserve positional order even as updatedAt changes, so without this
    // sort the sidebar shows the launch-time snapshot ordering.
    const byRecent = (a: Topic, b: Topic) => b.updatedAt - a.updatedAt;
    return {
      active: topics.filter((t) => matches(t) && !t.archived).sort(byRecent),
      archived: topics.filter((t) => matches(t) && t.archived).sort(byRecent),
    };
  }, [topics, query]);

  const grouped = useMemo(() => groupByTime(active), [active]);

  return (
    <aside className="left">
      <div className="left-head">
        <div className="logo" onClick={props.onHome} title="返回首页" style={{ cursor: "pointer" }}>S</div>
        <div className="name" onClick={props.onHome} style={{ cursor: "pointer" }}>SalmonApp</div>
        <div className="ver">v{pkg.version}</div>
      </div>

      <button
        className={`home-btn ${selectedId === null && props.topView === "home" ? "active" : ""}`}
        onClick={props.onHome}
      >
        <span className="home-icon">✦</span>
        <span>首页</span>
        <span className="home-sub">总览 / 未读</span>
      </button>

      <button
        className={`home-btn ${selectedId === null && props.topView === "mail" ? "active" : ""}`}
        onClick={props.onOpenMail}
        title="邮件 (alpha)"
      >
        <span className="home-icon">📧</span>
        <span>邮件</span>
        <span className="home-sub alpha-tag">alpha</span>
      </button>

      <button
        className={`home-btn ${selectedId === null && props.topView === "calendar" ? "active" : ""}`}
        onClick={props.onOpenCalendar}
        title="日历"
      >
        <span className="home-icon">📅</span>
        <span>日历</span>
      </button>

      <button
        className={`home-btn ${selectedId === null && props.topView === "tasks" ? "active" : ""}`}
        onClick={props.onOpenTasks}
        title="待办 (Google Tasks / Microsoft Todo)"
      >
        <span className="home-icon">📋</span>
        <span>待办</span>
      </button>

      <button className="new-btn" onClick={props.onNewTopic}>
        <span className="plus">＋</span> 新建 Topic
      </button>

      <div className="search">
        <input
          placeholder="搜索 Topic 标题..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              props.onOpenSearch(query.trim());
            }
          }}
        />
        <button
          className="search-open"
          onClick={() => props.onOpenSearch(query.trim())}
          title="全局搜索 Topic 和消息"
        >
          ⌕
        </button>
      </div>

      <div className="topic-list" ref={listRef}>
        {grouped.map(([label, items]) => (
          <div key={label}>
            <div className="group-label">{label}</div>
            {items.map((t) => (
              <div
                key={t.id}
                className={`topic ${selectedId === t.id ? "active" : ""}`}
                onClick={() => props.onSelect(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuFor(menuFor === t.id ? null : t.id);
                }}
              >
                <div className="t-row">
                  <span
                    className={`engine-pill ${
                      t.engine === "claude" ? "engine-cc" : "engine-cx"
                    }`}
                  >
                    {t.engine === "claude" ? "CC" : "CX"}
                  </span>
                  <span className="t-title">{t.title || "(未命名)"}</span>
                  {spawningId === t.id ? (
                    <span className="spinner-sm" title="启动中" />
                  ) : runningIds.has(t.id) ? (
                    <span className="t-dot" title="进行中" />
                  ) : null}
                </div>
                <div className="t-meta">
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
                    {shortPath(t.workdir)}
                  </span>
                  <span>{relativeTime(t.updatedAt)}</span>
                </div>
                {menuFor === t.id && (
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: 11 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRequestRenameTopic(t.id);
                        setMenuFor(null);
                      }}
                    >
                      重命名
                    </button>
                    <button
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: 11 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onArchiveTopic(t.id, true);
                        setMenuFor(null);
                      }}
                    >
                      归档
                    </button>
                    <button
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: 11, color: "#B7493D" }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        setMenuFor(null);
                        const ok = await ask(
                          `确认删除 Topic "${t.title}"？\n（仅删除 SalmonApp 内的对话记录，不会动你的工作目录文件）`,
                          { title: "删除 Topic", kind: "warning" },
                        );
                        if (ok) props.onDeleteTopic(t.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {active.length === 0 && archived.length === 0 && (
          <div className="empty" style={{ padding: 30, fontSize: 12 }}>
            还没有 Topic。<br />点上方"新建 Topic"开始。
          </div>
        )}

        {archived.length > 0 && (
          <div className="archived-group">
            <button
              className="archived-toggle"
              onClick={() => setShowArchived((v) => !v)}
            >
              <span className="caret" style={{ transform: showArchived ? "rotate(90deg)" : undefined }}>▸</span>
              已归档
              <span className="archived-count">{archived.length}</span>
            </button>
            {showArchived && archived.map((t) => (
              <div
                key={t.id}
                className={`topic archived ${selectedId === t.id ? "active" : ""}`}
                onClick={() => props.onSelect(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuFor(menuFor === t.id ? null : t.id);
                }}
              >
                <div className="t-row">
                  <span
                    className={`engine-pill ${t.engine === "claude" ? "engine-cc" : "engine-cx"}`}
                  >
                    {t.engine === "claude" ? "CC" : "CX"}
                  </span>
                  <span className="t-title">{t.title || "(未命名)"}</span>
                </div>
                <div className="t-meta">
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
                    {shortPath(t.workdir)}
                  </span>
                  <span>{relativeTime(t.updatedAt)}</span>
                </div>
                {menuFor === t.id && (
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: 11 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onArchiveTopic(t.id, false);
                        setMenuFor(null);
                      }}
                    >
                      取消归档
                    </button>
                    <button
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: 11, color: "#B7493D" }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        setMenuFor(null);
                        const ok = await ask(
                          `确认永久删除 Topic "${t.title}"?`,
                          { title: "永久删除 Topic", kind: "warning" },
                        );
                        if (ok) props.onDeleteTopic(t.id);
                      }}
                    >
                      永久删除
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="left-foot">
        {cliStatus.map((c) => {
          const cls = !c.installed ? "miss" : c.loggedIn ? "" : "warn";
          const state = !c.installed ? "未安装" : c.loggedIn ? "已登录" : "未登录";
          // Compact label so the gear stays on the same row even on the
          // 260px sidebar. Full state is in the tooltip — dot colour
          // already encodes ok / warn / miss at a glance.
          const short = c.binary === "claude" ? "Claude" : "Codex";
          return (
            <div
              key={c.binary}
              className={`health ${cls}`}
              title={`${c.name}: ${state}${c.path ? ` · ${c.path}` : ""}`}
            >
              <span className="dot" />
              {short}
            </div>
          );
        })}
        <button
          className="foot-gear"
          title="设置 / 用量"
          onClick={props.onOpenSettings}
          aria-label="设置"
        >
          ⚙
        </button>
      </div>
    </aside>
  );
}

function groupByTime(topics: Topic[]): [string, Topic[]][] {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const yesterdayMs = todayMs - 86400_000;
  const weekMs = todayMs - 6 * 86400_000;
  const buckets: Record<string, Topic[]> = { 今天: [], 昨天: [], 本周: [], 更早: [] };
  for (const t of topics) {
    if (t.updatedAt >= todayMs) buckets["今天"].push(t);
    else if (t.updatedAt >= yesterdayMs) buckets["昨天"].push(t);
    else if (t.updatedAt >= weekMs) buckets["本周"].push(t);
    else buckets["更早"].push(t);
  }
  return Object.entries(buckets).filter(([, v]) => v.length > 0);
}

function shortPath(p: string): string {
  const home = (window as any).__SALMON_HOME__ || "";
  let q = p;
  if (home && p.startsWith(home)) q = "~" + p.slice(home.length);
  if (q.length <= 30) return q;
  const parts = q.split("/").filter(Boolean);
  if (parts.length <= 2) return q;
  return "…/" + parts.slice(-2).join("/");
}
