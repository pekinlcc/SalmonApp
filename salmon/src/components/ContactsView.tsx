import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type {
  BriefItem,
  ContactBundle,
  MailAccount,
  SuggestedAction,
  UnifiedContact,
} from "../lib/types";
import { RelatedMailList } from "./RelatedMailList";
import { SalmonLogo } from "./SalmonLogo";

/**
 * v1.1 — Contacts view rewritten on top of `list_unified_contacts`.
 *
 * The list now includes "strangers" (counter-parties we've exchanged
 * mail with in the last 30 days who aren't synced into the saved
 * address book) and is sorted by ContactPulse priority score
 * (briefHigh × 100 + briefMedium × 10 + briefLow). Score = 0 contacts
 * are folded into a "静默" group at the bottom.
 *
 * The detail panel splits into two transparent sections:
 *   - [ContactPulse] — pending brief_items (LLM output). "无重要事项" when empty.
 *   - [Roost]        — the 30-day per-contact local aggregation Pulse was fed.
 */

function pulseScore(c: UnifiedContact): number {
  return c.briefHigh * 100 + c.briefMedium * 10 + c.briefLow;
}

export function ContactsView() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [contacts, setContacts] = useState<UnifiedContact[]>([]);
  const [selected, setSelected] = useState<UnifiedContact | null>(null);
  const [briefs, setBriefs] = useState<BriefItem[]>([]);
  const [bundle, setBundle] = useState<ContactBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSilent, setShowSilent] = useState(false);
  const [query, setQuery] = useState("");

  const loadContacts = useCallback(async () => {
    try {
      const a = await api.listMailAccounts();
      setAccounts(a);
      if (a.length === 0) { setContacts([]); return; }
      const all = await api.listUnifiedContacts(null);
      setContacts(all);
    } catch (e: any) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // Active = has any pending Pulse item OR seen in last 14 days. Everyone
  // else is folded under "静默". Within both buckets we sort by score desc,
  // then VIP, then recency — the user's directive is "按 ContactPulse
  // 优先级排"; the secondary VIP + recency keys only break ties.
  const { active, silent } = useMemo(() => {
    const cutoff = Date.now() - 14 * 86400_000;
    const q = query.trim().toLowerCase();
    const matches = (c: UnifiedContact) =>
      !q || c.email.toLowerCase().includes(q) || (c.name?.toLowerCase().includes(q) ?? false);

    const passing = contacts.filter(matches);
    const cmp = (a: UnifiedContact, b: UnifiedContact) => {
      const da = pulseScore(b) - pulseScore(a);
      if (da !== 0) return da;
      if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
      return (b.lastSeenMs ?? 0) - (a.lastSeenMs ?? 0);
    };
    const active = passing
      .filter((c) => pulseScore(c) > 0 || (c.lastSeenMs ?? 0) >= cutoff)
      .sort(cmp);
    const silent = passing
      .filter((c) => pulseScore(c) === 0 && (c.lastSeenMs ?? 0) < cutoff)
      .sort(cmp);
    return { active, silent };
  }, [contacts, query]);

  // Auto-select first contact on first load.
  useEffect(() => {
    if (selected) return;
    const first = active[0] || silent[0];
    if (first) setSelected(first);
  }, [active, silent, selected]);

  // Load detail data (Pulse + Roost) when selection changes.
  useEffect(() => {
    if (!selected) { setBriefs([]); setBundle(null); setBundleLoading(false); return; }
    let cancelled = false;
    setBundleLoading(true);
    (async () => {
      try {
        const [b, rb] = await Promise.all([
          api.listContactBriefItems(selected.email),
          api.getContactRoostBundle(selected.email).catch(() => null),
        ]);
        if (cancelled) return;
        setBriefs(b);
        setBundle(rb);
      } catch (e: any) {
        if (!cancelled) api.debugLog(`contacts detail load: ${e}`);
      } finally {
        if (!cancelled) setBundleLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  if (accounts.length === 0) {
    return (
      <div className="empty-feature">
        <div className="empty-icon">👥</div>
        <div className="empty-title">联系人</div>
        <div className="empty-sub">先到邮件里登录 Gmail / Outlook 账号 — 联系人用同一份 OAuth。</div>
      </div>
    );
  }

  const total = active.length + silent.length;

  return (
    <div className="three-pane">
      <aside className="three-list">
        <div className="left-head">
          <SalmonLogo className="logo" />
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
          {active.length > 0 ? (
            <>
              <div className="group-label">活跃 · 按 ContactPulse 优先级 · {active.length}</div>
              {active.map((c) => (
                <ContactItem key={c.id} c={c} selected={selected?.id === c.id} onClick={() => setSelected(c)} />
              ))}
            </>
          ) : (
            <div style={{ padding: 14, fontSize: 12, color: "var(--ink-500)" }}>
              暂无活跃联系人。{query ? "试试别的搜索词。" : "等下次 Briefing 跑完会有 ContactPulse 结果。"}
            </div>
          )}
          {silent.length > 0 && (
            <div className="archived-group">
              <button className="archived-toggle" onClick={() => setShowSilent((v) => !v)}>
                <span className="caret" style={{ transform: showSilent ? "rotate(90deg)" : undefined }}>▸</span>
                静默 · 无 Pulse 事项
                <span className="archived-count">{silent.length}</span>
              </button>
              {showSilent && silent.map((c) => (
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
            bundle={bundle}
            bundleLoading={bundleLoading}
            onToggleVip={async () => {
              if (!selected.isSaved) return;
              try {
                await api.setContactVip(selected.id, !selected.isVip);
                const next: UnifiedContact = { ...selected, isVip: !selected.isVip };
                setSelected(next);
                setContacts((cur) => cur.map((x) => x.id === selected.id ? next : x));
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

function ContactItem({ c, selected, onClick }: { c: UnifiedContact; selected: boolean; onClick: () => void }) {
  const score = pulseScore(c);
  const totalBriefs = c.briefHigh + c.briefMedium + c.briefLow;
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
        {!c.isSaved && (
          <span
            title="未保存到 Google / Outlook 联系人，仅从邮件往来识别到"
            style={{
              fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
              background: "#EEF2F4", color: "var(--ink-500)", fontWeight: 500,
              marginLeft: "auto",
            }}
          >未保存</span>
        )}
        {score > 0 && (
          <span
            title={`Pulse: 高 ${c.briefHigh} · 中 ${c.briefMedium} · 低 ${c.briefLow}`}
            style={{
              fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
              background: c.briefHigh > 0 ? "#FFE5D8" : "#F3E8FF",
              color: c.briefHigh > 0 ? "#B7493D" : "#6B21A8",
              fontWeight: 600,
              marginLeft: c.isSaved ? "auto" : 4,
            }}
          >{totalBriefs}</span>
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
  bundle,
  bundleLoading,
  onToggleVip,
}: {
  contact: UnifiedContact;
  briefs: BriefItem[];
  bundle: ContactBundle | null;
  bundleLoading: boolean;
  onToggleVip: () => void;
}) {
  return (
    <>
      <div className="mid-head">
        <div className="title">
          {contact.isVip && <span style={{ color: "#E8A82A", marginRight: 6 }}>★</span>}
          {contact.name || contact.email}
          {!contact.isSaved && (
            <span style={{
              marginLeft: 8, fontSize: 10.5, padding: "1px 6px", borderRadius: 4,
              background: "#EEF2F4", color: "var(--ink-500)", fontWeight: 500,
            }}>未保存</span>
          )}
        </div>
        {contact.isSaved && (
          <button className="btn-ghost" onClick={onToggleVip}>
            {contact.isVip ? "取消 VIP" : "设为 VIP"}
          </button>
        )}
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

        {/* [ContactPulse] — LLM output, persisted into brief_items */}
        <div className="three-section-label">
          [ContactPulse] · {briefs.length > 0 ? `${briefs.length} 项` : "无重要事项"} · LLM 输出
        </div>
        {briefs.length === 0 ? (
          <div style={{ padding: "10px 18px", fontSize: 12, color: "var(--ink-500)", lineHeight: 1.6 }}>
            该联系人当前没有 Pulse 标记的重要事项。
            <div style={{ marginTop: 2, fontSize: 11.5 }}>
              每次 Briefing 跑完会刷新；如果对方最近没什么需要决定的事，这里就是空的。
            </div>
          </div>
        ) : (
          briefs.map((b) => <ContactBriefCard key={b.id} item={b} />)
        )}

        {/* [Roost] — 30-day local aggregation, exactly what Pulse was fed */}
        <div className="three-section-label">
          [Roost] · 30 天本地聚合 · 纯本地 · 邮件 {bundle?.messages.length ?? 0}
          {bundle && bundle.events.length > 0 ? ` · 共同事件 ${bundle.events.length}` : ""}
        </div>
        {bundleLoading && !bundle ? (
          <div style={{ padding: "10px 18px", fontSize: 12, color: "var(--ink-500)" }}>加载中…</div>
        ) : !bundle ? (
          <div style={{ padding: "10px 18px", fontSize: 12, color: "var(--ink-500)" }}>
            最近 30 天没有跟此邮箱的邮件往来。
          </div>
        ) : (
          <>
            {bundle.events.length > 0 && (
              <div style={{ padding: "4px 18px 8px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-700)", margin: "6px 0" }}>
                  共同的日历事件 (±7 天)
                </div>
                {bundle.events.map((ev) => (
                  <div key={ev.id} style={{ fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: "var(--ink-900)" }}>{ev.title || "(无标题)"}</span>
                    <span style={{ color: "var(--ink-500)", marginLeft: 8 }}>
                      {shortDate(ev.startMs)}{ev.allDay ? " · 全天" : ""}
                      {ev.location ? ` @ ${ev.location}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {bundle.messages.length === 0 ? (
              <div style={{ padding: "10px 18px", fontSize: 12, color: "var(--ink-500)" }}>
                30 天内没有邮件。
              </div>
            ) : (
              bundle.messages.map((m) => (
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
                      {m.fromMe ? "我 →" : (contact.name || contact.email)}
                    </span>
                    <span className="mi-time">{shortDate(m.dateMs)}</span>
                  </div>
                  <div className="mi-subj">{m.subject || "(无主题)"}</div>
                  {m.snippet && <div className="mi-snip">{m.snippet}</div>}
                </div>
              ))
            )}
            {bundle.omittedMessageCount > 0 && (
              <div style={{ padding: "6px 18px 10px", fontSize: 11, color: "var(--ink-500)" }}>
                还有 {bundle.omittedMessageCount} 封更早的邮件未列出 (Pulse prompt 受限于 12 封上限)
              </div>
            )}
          </>
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
      {item.relatedMailIds.length > 0 && (
        <div style={{ padding: "0 12px 6px", fontSize: 12 }}>
          <RelatedMailList mailIds={item.relatedMailIds} />
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
