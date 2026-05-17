import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { CalEvent, MailListItem, SearchResult, Task, Topic } from "../lib/types";
import type { ToastActionTarget } from "../lib/notify";
import { relativeTime, shortPath } from "../lib/format";

interface Props {
  topics: Topic[];
  initialQuery?: string;
  onClose: () => void;
  /** v1.16.0: was `onSelect: (topicId) => void`. Search now spans mail /
   *  calendar / tasks / Topic / Topic-messages, so the callback takes
   *  a structured navigation target the App routes via its existing
   *  `navigateActionTarget` switch. */
  onNavigate: (target: ToastActionTarget) => void;
}

export function SearchDialog({ topics, initialQuery = "", onClose, onNavigate }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [msgResults, setMsgResults] = useState<SearchResult[]>([]);
  const [mailResults, setMailResults] = useState<MailListItem[]>([]);
  const [taskResults, setTaskResults] = useState<Task[]>([]);
  const [eventResults, setEventResults] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const topicHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return topics
      .filter((t) =>
        [t.title, t.workdir, t.engine].some((v) => v.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6);
  }, [topics, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    setError(null);
    if (q.length < 2) {
      setMsgResults([]);
      setMailResults([]);
      setTaskResults([]);
      setEventResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    // Debounce all four searches together so we don't fire on every keystroke.
    const timer = window.setTimeout(async () => {
      const now = Date.now();
      const calStart = now - 30 * 24 * 3600_000;
      const calEnd = now + 90 * 24 * 3600_000;

      const results = await Promise.allSettled([
        api.searchMessages(q, 40),
        api.searchMailMessages(q, null, 15),
        api.listTasks(null, false),
        api.listCalendarEvents(calStart, calEnd),
      ]);
      if (cancelled) return;

      const qLower = q.toLowerCase();

      // Topic messages
      const msgs = results[0].status === "fulfilled" ? results[0].value : [];
      // Mail rows already filtered server-side
      const mails = results[1].status === "fulfilled" ? results[1].value : [];
      // Tasks: client-side filter on title + notes
      const tasksAll = results[2].status === "fulfilled" ? results[2].value : [];
      const tasks = tasksAll
        .filter((t: Task) =>
          (t.title || "").toLowerCase().includes(qLower)
          || (t.notes || "").toLowerCase().includes(qLower)
        )
        .slice(0, 15);
      // Calendar: client-side filter on title + location + description
      const eventsAll = results[3].status === "fulfilled" ? results[3].value : [];
      const events = eventsAll
        .filter((e: CalEvent) =>
          (e.title || "").toLowerCase().includes(qLower)
          || (e.location || "").toLowerCase().includes(qLower)
          || (e.description || "").toLowerCase().includes(qLower)
        )
        .slice(0, 15);

      setMsgResults(msgs);
      setMailResults(mails);
      setTaskResults(tasks);
      setEventResults(events);

      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => String(r.reason));
      setError(errors.length > 0 ? errors[0] : null);

      setLoading(false);
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const navigate = (target: ToastActionTarget) => {
    onNavigate(target);
    onClose();
  };

  const totalNonTopic = mailResults.length + taskResults.length + eventResults.length + msgResults.length;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal-head">
          <h3>全局搜索</h3>
          <button className="btn btn-sm btn-icon btn-ghost" onClick={onClose} title="关闭">×</button>
        </div>
        <input
          ref={inputRef}
          className="global-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && topicHits[0]) navigate({ view: "topic", topicId: topicHits[0].id });
          }}
          placeholder="搜邮件 · 日历 · 待办 · Topic · 对话内容..."
        />

        {query.trim().length > 0 && query.trim().length < 2 && (
          <div className="search-empty">至少输入 2 个字符。</div>
        )}

        {topicHits.length > 0 && (
          <section className="search-section">
            <div className="search-section-title">Topic</div>
            {topicHits.map((t) => (
              <button key={t.id} className="search-result topic-hit" onClick={() => navigate({ view: "topic", topicId: t.id })}>
                <span className={`engine-pill ${t.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                  {t.engine === "claude" ? "CC" : "CX"}
                </span>
                <span className="search-result-main">
                  <span className="search-result-title">{t.title || "(未命名)"}</span>
                  <span className="search-result-snippet">{shortPath(t.workdir, 52)}</span>
                </span>
                <span className="search-result-time">{relativeTime(t.updatedAt)}</span>
              </button>
            ))}
          </section>
        )}

        {mailResults.length > 0 && (
          <section className="search-section">
            <div className="search-section-title">邮件</div>
            {mailResults.map((m) => (
              <button
                key={m.id}
                className="search-result"
                onClick={() => navigate({ view: "mail", messageId: m.id, accountId: m.accountId })}
              >
                <span className="engine-pill" style={{ background: "#E6F0FF", color: "#2F5BB7" }}>📧</span>
                <span className="search-result-main">
                  <span className="search-result-title">
                    {(m.subject || "(无主题)").trim()}
                    <span className="search-role">{m.fromName?.trim() || m.fromEmail?.trim() || "(unknown)"}</span>
                  </span>
                  <span className="search-result-snippet">{(m.snippet || "").trim()}</span>
                </span>
                <span className="search-result-time">{relativeTime(m.dateMs)}</span>
              </button>
            ))}
          </section>
        )}

        {eventResults.length > 0 && (
          <section className="search-section">
            <div className="search-section-title">日历</div>
            {eventResults.map((e) => (
              <button
                key={e.id}
                className="search-result"
                onClick={() => navigate({ view: "calendar", eventId: e.id, accountId: e.accountId, startMs: e.startMs })}
              >
                <span className="engine-pill" style={{ background: "#D8F0DD", color: "#266B33" }}>📅</span>
                <span className="search-result-main">
                  <span className="search-result-title">{(e.title || "(无标题)").trim()}</span>
                  <span className="search-result-snippet">
                    {e.allDay
                      ? new Date(e.startMs).toLocaleDateString("zh-CN")
                      : new Date(e.startMs).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    {e.location ? ` · ${e.location}` : ""}
                  </span>
                </span>
                <span className="search-result-time">{relativeTime(e.startMs)}</span>
              </button>
            ))}
          </section>
        )}

        {taskResults.length > 0 && (
          <section className="search-section">
            <div className="search-section-title">待办</div>
            {taskResults.map((t) => (
              <button
                key={t.id}
                className="search-result"
                onClick={() => navigate({ view: "tasks", taskId: t.id, accountId: t.accountId })}
              >
                <span className="engine-pill" style={{ background: "#FFF4D6", color: "#7A5B00" }}>✓</span>
                <span className="search-result-main">
                  <span className="search-result-title">{t.title || "(无标题)"}</span>
                  <span className="search-result-snippet">
                    {t.dueMs ? `截止 ${new Date(t.dueMs).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit" })}` : "无截止"}
                    {t.notes ? ` · ${t.notes.slice(0, 60)}` : ""}
                  </span>
                </span>
                <span className="search-result-time">{relativeTime(t.updatedAt)}</span>
              </button>
            ))}
          </section>
        )}

        <section className="search-section">
          <div className="search-section-title">
            对话消息
            {loading && <span className="search-loading">搜索中...</span>}
          </div>
          {error && <div className="welcome-recs-error">{error}</div>}
          {!loading && !error && query.trim().length >= 2 && totalNonTopic === 0 && topicHits.length === 0 && (
            <div className="search-empty">没有搜到匹配项。</div>
          )}
          {msgResults.map((r) => (
            <button key={r.messageId} className="search-result" onClick={() => navigate({ view: "topic", topicId: r.topicId })}>
              <span className={`engine-pill ${r.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                {r.engine === "claude" ? "CC" : "CX"}
              </span>
              <span className="search-result-main">
                <span className="search-result-title">
                  {r.topicTitle || "(未命名)"}
                  <span className="search-role">{r.role === "user" ? "你" : "助手"}</span>
                </span>
                <span className="search-result-snippet">{r.snippet}</span>
              </span>
              <span className="search-result-time">{relativeTime(r.createdAt)}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
