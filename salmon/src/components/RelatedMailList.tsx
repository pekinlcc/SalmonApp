import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { MailListItem } from "../lib/types";

/**
 * v1.1.1 — collapsed by default, expand to show each related mail row
 * (subject + from + date + snippet). Each row is clickable: dispatches
 * `salmon:open-mail-message` with `{ messageId, accountId }`, which
 * App.tsx routes to the Mail view with that mail selected.
 *
 * Used on brief cards in both BriefingFeed and ContactsView's
 * ContactBriefCard.
 */
export function RelatedMailList({ mailIds }: { mailIds: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [mails, setMails] = useState<MailListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || mails !== null) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api
      .getMailMessagesByIds(mailIds)
      .then((rows) => {
        if (cancelled) return;
        setMails(rows);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setErr(String(e));
        api.debugLog(`RelatedMailList load failed: ${e}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [expanded, mailIds, mails]);

  if (mailIds.length === 0) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: "transparent", border: 0, padding: 0,
          cursor: "pointer", color: "var(--ink-700)", font: "inherit",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        <b>关联邮件</b>
        <span>({mailIds.length})</span>
        <span
          style={{
            display: "inline-block",
            transition: "transform .12s ease",
            transform: expanded ? "rotate(90deg)" : undefined,
            color: "var(--ink-500)",
          }}
        >▸</span>
      </button>
      {expanded && (
        <div style={{ marginTop: 6, border: "1px solid var(--ink-100)", borderRadius: 6, overflow: "hidden" }}>
          {loading && !mails && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-500)" }}>加载中…</div>
          )}
          {err && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--salmon-700)" }}>加载失败：{err}</div>
          )}
          {mails && mails.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-500)" }}>
              相关邮件已被删除或未在本地同步范围内。
            </div>
          )}
          {mails && mails.map((m) => (
            <div
              key={m.id}
              className="mail-item"
              style={{ cursor: "pointer", borderTop: "1px solid var(--ink-100)" }}
              onClick={() => {
                window.dispatchEvent(new CustomEvent("salmon:open-mail-message", {
                  detail: { messageId: m.id, accountId: m.accountId },
                }));
              }}
            >
              <div className="mi-row">
                <span className="mi-from">
                  {m.unread && <span className="mi-dot" />}
                  {m.fromName || m.fromEmail || "(无)"}
                </span>
                <span className="mi-time">{formatDate(m.dateMs)}</span>
              </div>
              <div className="mi-subj">{m.subject || "(无主题)"}</div>
              {m.snippet && <div className="mi-snip">{m.snippet}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
