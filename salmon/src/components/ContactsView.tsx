import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { BriefItem, ContactRow, MailAccount, MailListItem, SuggestedAction } from "../lib/types";

/**
 * v0.11 — top-level Contacts view. Extracted from the contacts pane that
 * used to live inside MailView. Now has its own rail entry + 3-segment
 * importance sort:
 *   1. ★ VIP · 有未处理事项 (is_vip && pending brief_items > 0)
 *   2. 最近 · 14 天内 (recent activity, VIP-but-no-brief lands here too)
 *   3. 静默 · 无事项 (collapsed by default)
 */

type Segment = "vip-brief" | "recent" | "silent";

interface ContactWithBriefs extends ContactRow {
  briefCount: number;
}

export function ContactsView() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [contacts, setContacts] = useState<ContactWithBriefs[]>([]);
  const [selected, setSelected] = useState<ContactWithBriefs | null>(null);
  const [briefs, setBriefs] = useState<BriefItem[]>([]);
  const [mail, setMail] = useState<MailListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSilent, setShowSilent] = useState(false);
  const [query, setQuery] = useState("");

  const loadContacts = useCallback(async () => {
    try {
      const a = await api.listMailAccounts();
      setAccounts(a);
      if (a.length === 0) { setContacts([]); return; }
      const all = await api.listContacts(null);
      // Look up brief counts per contact email in one pass — listBriefItems
      // gives us the current briefing's items; we filter client-side.
      let items: BriefItem[] = [];
      try { items = await api.listBriefItems(null); } catch {}
      const briefByEmail = new Map<string, number>();
      for (const it of items) {
        if (it.status !== "pending") continue;
        if (!it.contactEmail) continue;
        const k = it.contactEmail.toLowerCase();
        briefByEmail.set(k, (briefByEmail.get(k) || 0) + 1);
      }
      const enriched: ContactWithBriefs[] = all.map((c) => ({
        ...c,
        briefCount: briefByEmail.get(c.email.toLowerCase()) || 0,
      }));
      setContacts(enriched);
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // ── 3-segment sort ────────────────────────────────────────────
  const grouped = useMemo(() => {
    const cutoff = Date.now() - 14 * 86400_000;
    const q = query.trim().toLowerCase();
    const matches = (c: ContactWithBriefs) =>
      !q || c.email.toLowerCase().includes(q) || (c.name?.toLowerCase().includes(q));

    const out: Record<Segment, ContactWithBriefs[]> = {
      "vip-brief": [],
      "recent": [],
      "silent": [],
    };
    for (const c of contacts) {
      if (!matches(c)) continue;
      const hasRecent = (c.lastSeenMs ?? 0) >= cutoff;
      if (c.isVip && c.briefCount > 0) {
        out["vip-brief"].push(c);
      } else if (hasRecent || c.briefCount > 0) {
        out["recent"].push(c);
      } else {
        out["silent"].push(c);
      }
    }
    // Sort each segment
    out["vip-brief"].sort((a, b) => b.briefCount - a.briefCount || (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0));
    out["recent"].sort((a, b) => {
      // VIPs first, then by last_seen
      if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
      return (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0);
    });
    out["silent"].sort((a, b) => b.interactionCount - a.interactionCount);
    return out;
  }, [contacts, query]);

  // Auto-select first contact in the first non-empty segment on first load.
  useEffect(() => {
    if (selected) return;
    const first = grouped["vip-brief"][0] || grouped["recent"][0] || grouped["silent"][0];
    if (first) setSelected(first);
  }, [grouped, selected]);

  // Load detail data when selection changes.
  useEffect(() => {
    if (!selected) { setBriefs([]); setMail([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const [b, m] = await Promise.all([
          api.listContactBriefItems(selected.email),
          (async () => {
            // Pick the account that matches the contact's account_id if set,
            // else any account.
            const accountId = selected.accountId || accounts[0]?.id;
            if (!accountId) return [];
            return api.listContactMail(accountId, selected.email, 30);
          })(),
        ]);
        if (cancelled) return;
        setBriefs(b);
        setMail(m);
      } catch (e: any) {
        if (!cancelled) api.debugLog(`contacts detail load: ${e}`);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, accounts]);

  if (accounts.length === 0) {
    return (
      <div className="empty-feature">
        <div className="empty-icon">👥</div>
        <div className="empty-title">联系人</div>
        <div className="empty-sub">先到邮件里登录 Gmail / Outlook 账号 — 联系人用同一份 OAuth。</div>
      </div>
    );
  }

  const total = grouped["vip-brief"].length + grouped["recent"].length + grouped["silent"].length;

  return (
    <div className="three-pane">
      <aside className="three-list">
        <div className="left-head">
          <div className="logo">👥</div>
          <div className="name">联系人</div>
          <div className="ver">{total}</div>
        </div>
        <div className="search">
          <input
            placeholder="搜联系人..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="topic-list">
          {grouped["vip-brief"].length > 0 && (
            <>
              <div className="group-label">★ VIP · 有未处理事项 · {grouped["vip-brief"].length}</div>
              {grouped["vip-brief"].map((c) => (
                <ContactItem key={c.id} c={c} selected={selected?.id === c.id} onClick={() => setSelected(c)} />
              ))}
            </>
          )}
          {grouped["recent"].length > 0 && (
            <>
              <div className="group-label">最近 · 14 天内 · {grouped["recent"].length}</div>
              {grouped["recent"].map((c) => (
                <ContactItem key={c.id} c={c} selected={selected?.id === c.id} onClick={() => setSelected(c)} />
              ))}
            </>
          )}
          {grouped["silent"].length > 0 && (
            <div className="archived-group">
              <button className="archived-toggle" onClick={() => setShowSilent((v) => !v)}>
                <span className="caret" style={{ transform: showSilent ? "rotate(90deg)" : undefined }}>▸</span>
                静默 · 无事项
                <span className="archived-count">{grouped["silent"].length}</span>
              </button>
              {showSilent && grouped["silent"].map((c) => (
                <ContactItem key={c.id} c={c} selected={selected?.id === c.id} onClick={() => setSelected(c)} />
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="three-detail">
        {selected ? (
          <ContactDetail
            contact={selected}
            briefs={briefs}
            mail={mail}
            onToggleVip={async () => {
              try {
                await api.setContactVip(selected.id, !selected.isVip);
                setSelected({ ...selected, isVip: !selected.isVip });
                setContacts((cur) => cur.map((x) => x.id === selected.id ? { ...x, isVip: !selected.isVip } : x));
              } catch (e: any) { alert(String(e)); }
            }}
          />
        ) : (
          <div className="empty-feature">
            <div className="empty-icon">👥</div>
            <div className="empty-sub">选一个联系人查看</div>
          </div>
        )}
        {error && <div style={{ padding: 12, color: "#B7493D", fontSize: 12 }}>{error}</div>}
      </section>
    </div>
  );
}

function ContactItem({ c, selected, onClick }: { c: ContactWithBriefs; selected: boolean; onClick: () => void }) {
  return (
    <div
      className={`topic ${selected ? "active" : ""}`}
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
      <div className="t-row">
        <span className="t-title">
          {c.isVip && <span style={{ color: "#E8A82A", marginRight: 4 }}>★</span>}
          {c.name || c.email}
        </span>
        {c.briefCount > 0 && (
          <span style={{
            fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
            background: "#FFE5D8", color: "#B7493D", fontWeight: 600,
          }}>{c.briefCount}</span>
        )}
      </div>
      <div className="t-meta">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
          {c.email}
        </span>
        <span>{c.lastSeenMs ? timeAgo(c.lastSeenMs) : "—"}</span>
      </div>
    </div>
  );
}

function ContactDetail({
  contact,
  briefs,
  mail,
  onToggleVip,
}: {
  contact: ContactWithBriefs;
  briefs: BriefItem[];
  mail: MailListItem[];
  onToggleVip: () => void;
}) {
  return (
    <>
      <div className="mid-head">
        <div className="title">
          {contact.isVip && <span style={{ color: "#E8A82A", marginRight: 6 }}>★</span>}
          {contact.name || contact.email}
        </div>
        <button className="btn-ghost" onClick={onToggleVip}>
          {contact.isVip ? "取消 VIP" : "设为 VIP"}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="three-section-label">联系信息</div>
        <div className="three-info-row"><span className="k">邮箱：</span><span>{contact.email}</span></div>
        {contact.organization && (
          <div className="three-info-row"><span className="k">组织：</span><span>{contact.organization}</span></div>
        )}
        <div className="three-info-row"><span className="k">互动：</span>
          <span>{contact.interactionCount} 次{contact.lastSeenMs ? ` · 最近 ${timeAgo(contact.lastSeenMs)}` : ""}</span>
        </div>

        {briefs.length > 0 && (
          <>
            <div className="three-section-label">✦ AI 重点事项 · {briefs.length}</div>
            {briefs.map((b) => (
              <ContactBriefCard key={b.id} item={b} />
            ))}
          </>
        )}

        <div className="three-section-label">📧 最近往来 · {mail.length}</div>
        {mail.length === 0 ? (
          <div style={{ padding: "10px 18px", fontSize: 12, color: "#6B7280" }}>没有邮件往来记录。</div>
        ) : (
          mail.map((m) => (
            <div
              key={m.id}
              className="mail-item"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("salmon:open-mail-message", {
                  detail: { messageId: m.id },
                }));
              }}
              style={{ cursor: "pointer" }}
            >
              <div className="mi-row">
                <span className="mi-from">
                  {m.unread && <span className="mi-dot" />}
                  {m.fromName || m.fromEmail || "(无)"}
                </span>
                <span className="mi-time">{shortDate(m.dateMs)}</span>
              </div>
              <div className="mi-subj">{m.subject || "(无主题)"}</div>
              {m.snippet && <div className="mi-snip">{m.snippet}</div>}
            </div>
          ))
        )}
      </div>
    </>
  );
}

function ContactBriefCard({ item }: { item: BriefItem }) {
  const prioClass = item.priority === "high" ? "prio-high" : item.priority === "low" ? "prio-low" : "prio-medium";
  const prioLabel = item.priority === "high" ? "高" : item.priority === "low" ? "低" : "中";
  return (
    <div className="brief-card" style={{ margin: "10px 18px" }}>
      <div className="brief-head">
        <div className="brief-icon">📧</div>
        <div className="brief-titles">
          <div className="brief-title">{item.title}</div>
          <div className="brief-meta">
            <span className={`prio-pill ${prioClass}`}>{prioLabel}</span>
          </div>
        </div>
      </div>
      {item.summary && <div className="brief-summary">{item.summary}</div>}
      {item.why && (
        <div className="brief-why">
          <span className="brief-why-label">↗ AI 解释：</span>
          {item.why}
        </div>
      )}
      <div className="brief-actions-section">
        <div className="brief-actions">
          {item.suggestedActions.slice(0, 4).map((a: SuggestedAction, i: number) => (
            <button
              key={i}
              className={`brief-btn ${i === 0 ? "primary" : ""}`}
              onClick={async () => {
                try {
                  await api.executeActionStep({
                    itemId: item.id,
                    actionIndex: i,
                    stepIndices: null,
                  });
                  window.dispatchEvent(new CustomEvent("salmon:toast", {
                    detail: { title: `✓ 执行 ${a.label}`, kind: "done" },
                  }));
                } catch (e: any) {
                  window.dispatchEvent(new CustomEvent("salmon:toast", {
                    detail: { title: `执行失败: ${e}`, kind: "error" },
                  }));
                }
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function timeAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "刚刚";
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 86400_000)} 天前`;
}
function shortDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
