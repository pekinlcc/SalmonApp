import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { SearchResult, Topic } from "../lib/types";
import { relativeTime, shortPath } from "../lib/format";

interface Props {
  topics: Topic[];
  initialQuery?: string;
  onClose: () => void;
  onSelect: (topicId: string) => void;
}

export function SearchDialog({ topics, initialQuery = "", onClose, onSelect }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
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
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchMessages(q, 40)
        .then((rs) => {
          if (!cancelled) setResults(rs);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const openTopic = (id: string) => {
    onSelect(id);
    onClose();
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal-head">
          <h3>全局搜索</h3>
          <button className="btn icon-btn" onClick={onClose} title="关闭">×</button>
        </div>
        <input
          ref={inputRef}
          className="global-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && topicHits[0]) openTopic(topicHits[0].id);
          }}
          placeholder="搜 Topic、消息内容、路径..."
        />

        {query.trim().length > 0 && query.trim().length < 2 && (
          <div className="search-empty">至少输入 2 个字符。</div>
        )}

        {topicHits.length > 0 && (
          <section className="search-section">
            <div className="search-section-title">Topic</div>
            {topicHits.map((t) => (
              <button key={t.id} className="search-result topic-hit" onClick={() => openTopic(t.id)}>
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

        <section className="search-section">
          <div className="search-section-title">
            消息
            {loading && <span className="search-loading">搜索中...</span>}
          </div>
          {error && <div className="welcome-recs-error">{error}</div>}
          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <div className="search-empty">没有搜到消息。</div>
          )}
          {results.map((r) => (
            <button key={r.messageId} className="search-result" onClick={() => openTopic(r.topicId)}>
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
