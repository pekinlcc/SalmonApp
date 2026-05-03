import { useMemo, useState } from "react";
import type { CliInfo, Topic } from "../lib/types";
import { relativeTime } from "../lib/format";

interface Props {
  topics: Topic[];
  selectedId: string | null;
  runningIds: Set<string>;
  spawningId: string | null;
  cliStatus: CliInfo[];
  onSelect: (id: string) => void;
  onNewTopic: () => void;
  onOpenSettings: () => void;
  onDeleteTopic: (id: string) => void;
  onRenameTopic: (id: string, title: string) => void;
  onArchiveTopic: (id: string, archived: boolean) => void;
}

export function LeftSidebar(props: Props) {
  const { topics, selectedId, runningIds, spawningId, cliStatus } = props;
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const [showArchived, setShowArchived] = useState(false);

  const { active, archived } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: Topic) => !q || t.title.toLowerCase().includes(q);
    return {
      active: topics.filter((t) => matches(t) && !t.archived),
      archived: topics.filter((t) => matches(t) && t.archived),
    };
  }, [topics, query]);

  const grouped = useMemo(() => groupByTime(active), [active]);

  return (
    <aside className="left">
      <div className="left-head">
        <div className="logo">S</div>
        <div className="name">Salmon</div>
        <div className="ver">v0.3.4</div>
        <button
          className="settings-btn"
          title="设置"
          onClick={props.onOpenSettings}
        >
          ⚙
        </button>
      </div>

      <button className="new-btn" onClick={props.onNewTopic}>
        <span className="plus">＋</span> 新建 Topic
      </button>

      <div className="search">
        <input
          placeholder="搜索 Topic 标题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="topic-list">
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
                        const t2 = window.prompt("重命名 Topic", t.title);
                        if (t2 && t2 !== t.title) props.onRenameTopic(t.id, t2);
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
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`确认删除 Topic "${t.title}"？\n（仅删除 Salmon 内的对话记录，不会动你的工作目录文件）`)) {
                          props.onDeleteTopic(t.id);
                        }
                        setMenuFor(null);
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
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`确认永久删除 Topic "${t.title}"?`)) {
                          props.onDeleteTopic(t.id);
                        }
                        setMenuFor(null);
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
          const label = !c.installed ? "未安装" : c.loggedIn ? "已登录" : "未登录";
          return (
            <div key={c.binary} className={`health ${cls}`} title={c.path || ""}>
              <span className="dot" />
              {c.name}: {label}
            </div>
          );
        })}
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
