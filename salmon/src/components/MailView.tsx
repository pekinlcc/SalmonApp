import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import type { ContactRow, MailAccount, MailListItem, MailMessageFull, MailSyncProgress } from "../lib/types";
import { ComposeModal } from "./ComposeModal";

/**
 * v0.9.1 — full mail client.
 * Layout: account/folder rail | message list | reader.
 * Contacts pane lives behind a toggle in the rail.
 *
 * `pendingComposeReply` is the AI-drafted reply payload from the home
 * BriefingFeed. App.tsx stashes it the moment the user clicks "在邮件撰写
 * 窗口打开" (before MailView mounts) so we don't lose it to a listener-
 * registration race when topView switches to "mail".
 */
interface MailViewProps {
  pendingComposeReply?: { replyToMailId: string; bodyText?: string } | null;
  onConsumeComposeReply?: () => void;
}

export function MailView({ pendingComposeReply, onConsumeComposeReply }: MailViewProps = {}) {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MailListItem[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedBody, setSelectedBody] = useState<MailMessageFull | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<MailSyncProgress | null>(null);
  const [oauthStatus, setOauthStatus] = useState<{ googleConfigured: boolean; microsoftConfigured: boolean }>({
    googleConfigured: true,
    microsoftConfigured: false,
  });
  const [bootError, setBootError] = useState<string | null>(null);
  const [compose, setCompose] = useState<
    | { mode: "new" }
    | { mode: "reply" | "replyAll" | "forward"; msg: MailMessageFull; draftBody?: string }
    | null
  >(null);
  const [showContacts, setShowContacts] = useState(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactRow | null>(null);

  // Cross-event listener body needs the latest selectedAccountId, but
  // wiring the listener with that state as a dep makes us unmount/remount
  // the Tauri listener on every account switch. Keep a ref in sync so the
  // listener always reads the current value.
  const selectedAccountIdRef = useRef<string | null>(null);
  useEffect(() => { selectedAccountIdRef.current = selectedAccountId; }, [selectedAccountId]);

  // Close the "+ 添加账号" dropdown when clicking anywhere outside it.
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addMenuOpen]);

  const reloadAccounts = useCallback(async () => {
    try {
      const a = await api.listMailAccounts();
      setAccounts(a);
      if (a.length > 0 && !selectedAccountId) {
        setSelectedAccountId(a[0].id);
      }
    } catch (e: any) {
      setBootError(String(e));
    }
  }, [selectedAccountId]);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.getOauthStatus();
        setOauthStatus(s);
      } catch {}
      await reloadAccounts();
    })();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let un: UnlistenFn | undefined;
    listen("salmon-mail-accounts", () => { reloadAccounts(); }).then((u) => { un = u; });
    return () => { un?.(); };
  }, [reloadAccounts]);

  // v0.9.1: BriefingFeed → AI-drafted reply handoff via App.tsx stashed
  // prop. Previously we listened for a custom DOM event but the event
  // fired while MailView was still unmounted, so the listener missed it.
  // Now App.tsx holds the pending payload and we pick it up on mount /
  // when it changes.
  useEffect(() => {
    if (!pendingComposeReply?.replyToMailId) return;
    let cancelled = false;
    (async () => {
      try {
        const msg = await api.getMailMessage(pendingComposeReply.replyToMailId);
        if (cancelled) return;
        setCompose({ mode: "reply", msg, draftBody: pendingComposeReply.bodyText });
        onConsumeComposeReply?.();
      } catch (err: any) {
        alert(`打开回信失败: ${err}`);
        onConsumeComposeReply?.();
      }
    })();
    return () => { cancelled = true; };
  }, [pendingComposeReply, onConsumeComposeReply]);

  useEffect(() => {
    let un: UnlistenFn | undefined;
    listen<MailSyncProgress>("salmon-mail-sync", (e) => {
      setSyncProgress(e.payload);
      if (e.payload.stage === "done") {
        setSyncing(false);
        // Compare against the ref, not a captured closure — selectedAccountId
        // can flip while a sync is in flight, and we want to reload the
        // message list only when the just-finished sync matches what the
        // user is *currently* looking at.
        if (e.payload.accountId === selectedAccountIdRef.current) {
          reloadMessages(e.payload.accountId);
        }
        // Refresh just the accounts list (unread counts etc.) — do NOT
        // call reloadAccounts here. That callback closes over
        // selectedAccountId === null (this effect runs once at mount)
        // and would re-set the selection to a[0].id on every sync, yanking
        // the user back to the first account whenever any sync finished.
        api.listMailAccounts().then(setAccounts).catch(() => {});
      }
    }).then((u) => { un = u; });
    return () => { un?.(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const reloadMessages = useCallback(async (accountId: string) => {
    try {
      const m = await api.listInboxMessages(accountId);
      setMessages(m);
    } catch (e: any) {
      api.debugLog(`listInboxMessages failed: ${e}`);
    }
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    reloadMessages(selectedAccountId);
    setSelectedMessageId(null);
    setSelectedBody(null);
  }, [selectedAccountId, reloadMessages]);

  // Separately, when the user switches account *while the contacts pane is
  // open*, refresh contacts to match — kept in its own effect so toggling
  // the pane on/off doesn't accidentally re-fire the message-list reset
  // above and yank the open message out from under them.
  useEffect(() => {
    if (!selectedAccountId || !showContacts) return;
    api.listContacts(selectedAccountId)
      .then(setContacts)
      .catch((e) => api.debugLog(`listContacts on account switch failed: ${e}`));
  }, [selectedAccountId, showContacts]);

  useEffect(() => {
    if (!selectedMessageId) { setSelectedBody(null); return; }
    // Guard against out-of-order resolution: if the user clicks message A,
    // then quickly clicks B before A's getMailMessage returns, both promises
    // can race and end up writing whichever one resolves *last* into
    // selectedBody. cancelled = true tells the older promise to drop its
    // payload when this effect re-fires (or unmounts).
    let cancelled = false;
    api.getMailMessage(selectedMessageId).then((m) => {
      if (cancelled) return;
      setSelectedBody(m);
      // Auto-mark-read on open for unread messages. Works for both Gmail
      // (label modify) and Outlook (isRead PATCH).
      if (m.unread) {
        api.markMailRead(m.id, true).then(() => {
          if (cancelled) return;
          setMessages((cur) => cur.map((x) => x.id === m.id ? { ...x, unread: false } : x));
          reloadAccounts();
        }).catch((e) => api.debugLog(`auto mark_read failed: ${e}`));
      }
    }).catch((e) => {
      if (cancelled) return;
      api.debugLog(`getMailMessage failed: ${e}`);
      setSelectedBody(null);
    });
    return () => { cancelled = true; };
  }, [selectedMessageId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const onAddGmail = useCallback(async () => {
    if (!oauthStatus.googleConfigured) {
      alert(
        "Google OAuth 未配置。仓库根目录的 OAUTH-SETUP.md 教你怎么注册。\n" +
          "拿到 client_id + secret 后，填进 salmon/src-tauri/oauth_config.toml，重启 SalmonApp。"
      );
      return;
    }
    try {
      const account = await api.startGmailOauth();
      setAccounts((cur) => cur.find((a) => a.id === account.id) ? cur : [...cur, account]);
      setSelectedAccountId(account.id);
      setSyncing(true);
      api.syncMailAccount(account.id).catch((e) => {
        setSyncing(false);
        api.debugLog(`initial sync failed: ${e}`);
      });
      // Best-effort contacts sync.
      api.syncContacts(account.id).catch(() => {});
    } catch (e: any) {
      alert(`Gmail 登录失败: ${e}`);
    }
  }, [oauthStatus]);

  const onAddOutlook = useCallback(async () => {
    if (!oauthStatus.microsoftConfigured) {
      alert(
        "Microsoft OAuth 未配置。\nOAUTH-SETUP.md Part 2 教你怎么注册。\n" +
          "拿到 client_id 后，填进 oauth_config.toml 的 [microsoft]，重启 SalmonApp。"
      );
      return;
    }
    try {
      const account = await api.startOutlookOauth();
      setAccounts((cur) => cur.find((a) => a.id === account.id) ? cur : [...cur, account]);
      setSelectedAccountId(account.id);
      setSyncing(true);
      api.syncMailAccount(account.id).catch((e) => {
        setSyncing(false);
        api.debugLog(`initial sync failed: ${e}`);
      });
      api.syncContacts(account.id).catch(() => {});
    } catch (e: any) {
      alert(`Outlook 登录失败: ${e}`);
    }
  }, [oauthStatus]);

  const onResync = useCallback(async () => {
    if (!selectedAccountId) return;
    setSyncing(true);
    try { await api.syncMailAccount(selectedAccountId); }
    catch (e: any) { setSyncing(false); alert(`同步失败: ${e}`); }
  }, [selectedAccountId]);

  const onRemoveAccount = useCallback(async () => {
    if (!selectedAccountId) return;
    if (!confirm("移除该账号？本地缓存的邮件会一起删除（你 Gmail 上的邮件不会动）。")) return;
    try {
      await api.deleteMailAccount(selectedAccountId);
      setSelectedAccountId(null);
      setMessages([]);
      setSelectedMessageId(null);
      setSelectedBody(null);
      reloadAccounts();
    } catch (e: any) { alert(`删除失败: ${e}`); }
  }, [selectedAccountId, reloadAccounts]);

  // Just flip the boolean — the showContacts/selectedAccountId effect above
  // does the actual fetch (and keeps things in sync if the user later
  // switches accounts while the pane is still open).
  const onToggleContacts = useCallback(() => {
    setShowContacts((cur) => !cur);
  }, []);

  const onMarkUnread = useCallback(async () => {
    if (!selectedBody) return;
    try {
      await api.markMailRead(selectedBody.id, false);
      setMessages((cur) => cur.map((x) => x.id === selectedBody.id ? { ...x, unread: true } : x));
      setSelectedBody({ ...selectedBody, unread: true });
      reloadAccounts();
    } catch (e: any) { alert(`标记失败: ${e}`); }
  }, [selectedBody, reloadAccounts]);

  // ── Render ─────────────────────────────────────────────────────────

  if (bootError) {
    return <div className="empty-feature"><div className="empty-title">加载失败</div><div className="empty-sub">{bootError}</div></div>;
  }

  if (!oauthStatus.googleConfigured && !oauthStatus.microsoftConfigured) {
    return (
      <div className="empty-feature">
        <div className="empty-icon">🔑</div>
        <div className="empty-title">邮箱 OAuth 未配置</div>
        <div className="empty-sub">
          SalmonApp 需要你在 Google Cloud Console（Gmail）或 Azure（Outlook）注册一个应用。Google 需要 client_id + client_secret；Microsoft 桌面公共客户端只需要 client_id（用 PKCE）。把值填进
          {" "}<code>salmon/src-tauri/oauth_config.toml</code>，重启即可。
          <br />
          手把手指南在仓库根目录 <code>OAUTH-SETUP.md</code>。
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="empty-feature">
        <div className="empty-icon">📧</div>
        <div className="empty-title">还没添加邮箱账号</div>
        <div className="empty-sub">
          点下面按钮通过 OAuth 登录。授权后 SalmonApp 会拉最近 90 天 / 最多 1000 封邮件到本地。
          <br />
          整个过程在本机进行；token 存在本地 SQLite。
        </div>
        <div className="empty-actions" style={{ gap: 10 }}>
          {oauthStatus.googleConfigured && (
            <button className="btn primary" onClick={onAddGmail}>＋ 添加 Gmail</button>
          )}
          {oauthStatus.microsoftConfigured && (
            <button className="btn primary" onClick={onAddOutlook}>＋ 添加 Outlook</button>
          )}
        </div>
      </div>
    );
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  return (
    <div className="mail-shell">
      <div className="mail-head">
        <div className="mail-title">📧 邮件</div>
        <div className="mail-sub">
          {selectedAccount?.email}
          {selectedAccount?.lastSyncAt && (
            <span style={{ marginLeft: 10 }}>· 同步于 {timeAgo(selectedAccount.lastSyncAt)}</span>
          )}
        </div>
        <div className="mail-actions">
          {syncing && syncProgress && (
            <span className="sync-progress">
              {syncProgress.stage === "listing" ? "枚举中…" : `${syncProgress.fetched}/${syncProgress.total}`}
            </span>
          )}
          <button className="btn primary" onClick={() => setCompose({ mode: "new" })}>＋ 新邮件</button>
          <button className="btn-ghost" onClick={onResync} disabled={syncing}>
            {syncing ? "同步中…" : "↻ 同步"}
          </button>
          <button className="btn-ghost" onClick={onToggleContacts}>
            {showContacts ? "← 邮件" : "👥 联系人"}
          </button>
          <div className="add-account-wrap" ref={addMenuRef}>
            <button
              className="btn-ghost"
              onClick={() => setAddMenuOpen((v) => !v)}
              title="添加邮箱账号"
            >
              ＋ 添加账号 ▾
            </button>
            {addMenuOpen && (
              <div className="add-account-menu" onClick={() => setAddMenuOpen(false)}>
                {oauthStatus.googleConfigured ? (
                  <button onClick={onAddGmail}>
                    <span className="prov-tag" style={{ marginRight: 8 }}>G</span>Gmail
                  </button>
                ) : (
                  <div className="add-account-disabled">Gmail 未配置 OAuth</div>
                )}
                {oauthStatus.microsoftConfigured ? (
                  <button onClick={onAddOutlook}>
                    <span className="prov-tag" style={{ marginRight: 8 }}>O</span>Outlook
                  </button>
                ) : (
                  <div className="add-account-disabled">Outlook 未配置 OAuth</div>
                )}
              </div>
            )}
          </div>
          <button className="btn-ghost" onClick={onRemoveAccount}>移除当前</button>
        </div>
      </div>
      <div className={`mail-grid ${accounts.length <= 1 ? "single-account" : ""}`}>
        {accounts.length > 1 && (
          <aside className="mail-rail">
            {accounts.map((a) => (
              <button
                key={a.id}
                className={`mail-acct ${a.id === selectedAccountId ? "active" : ""}`}
                onClick={() => setSelectedAccountId(a.id)}
                title={`${a.provider} · ${a.email}`}
              >
                <div className="mail-acct-email">
                  <span className="prov-tag">{a.provider === "outlook" ? "O" : "G"}</span>
                  {a.email}
                </div>
                {a.unreadCount > 0 && <span className="mail-acct-badge">{a.unreadCount}</span>}
              </button>
            ))}
          </aside>
        )}

        {showContacts ? (
          <section className="mail-list mail-contacts" role="list">
            {contacts.length === 0 ? (
              <div className="mail-empty">
                还没同步联系人。<br />
                <button className="btn primary" style={{ marginTop: 12 }}
                  onClick={async () => {
                    if (!selectedAccountId) return;
                    try {
                      const n = await api.syncContacts(selectedAccountId);
                      const c = await api.listContacts(selectedAccountId);
                      setContacts(c);
                      alert(`已同步 ${n} 个`);
                    } catch (e: any) { alert(`联系人同步失败: ${e}`); }
                  }}
                >↻ 同步联系人</button>
              </div>
            ) : (
              contacts.map((c) => (
                <div
                  key={c.id}
                  className={`contact-row ${selectedContact?.id === c.id ? "selected" : ""}`}
                  onClick={() => { setSelectedContact(c); setSelectedMessageId(null); setSelectedBody(null); }}
                  style={{ cursor: "pointer" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="contact-name">
                      {c.isVip && <span className="vip-star">★</span>}
                      {c.name || c.email}
                    </div>
                    <div className="contact-meta">
                      {c.email}{c.organization ? ` · ${c.organization}` : ""}
                    </div>
                    <div className="contact-meta-dim">
                      互动 {c.interactionCount} 次{c.lastSeenMs ? ` · 最近 ${timeAgo(c.lastSeenMs)}` : ""}
                    </div>
                  </div>
                  <button
                    className="btn-ghost"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await api.setContactVip(c.id, !c.isVip);
                        setContacts((cur) => cur.map((x) => x.id === c.id ? { ...x, isVip: !c.isVip } : x));
                      } catch (err: any) { alert(String(err)); }
                    }}
                    title={c.isVip ? "取消 VIP" : "设为 VIP（信息会优先出现在首页）"}
                  >
                    {c.isVip ? "取消 VIP" : "设 VIP"}
                  </button>
                </div>
              ))
            )}
          </section>
        ) : (
          <section className="mail-list" role="list">
            {messages.length === 0 ? (
              <div className="mail-empty">
                {syncing ? "首次同步中，等一下…" : "(收件箱为空) — 点 ↻ 同步"}
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  role="listitem"
                  className={`mail-item ${m.unread ? "unread" : ""} ${m.id === selectedMessageId ? "selected" : ""}`}
                  onClick={() => setSelectedMessageId(m.id)}
                >
                  <div className="mi-row">
                    <span className="mi-from">
                      {m.unread && <span className="mi-dot" />}
                      {m.fromName || m.fromEmail || "(无)"}
                    </span>
                    <span className="mi-time">{shortDate(m.dateMs)}</span>
                  </div>
                  <div className="mi-subj">{m.subject || "(无主题)"}</div>
                  <div className="mi-snip">{m.snippet}</div>
                </div>
              ))
            )}
          </section>
        )}

        <section className="mail-reader">
          {selectedContact ? (
            <ContactDetail
              contact={selectedContact}
              onClose={() => setSelectedContact(null)}
              onOpenMessage={(mid) => {
                // Tapping a thread row inside the contact panel: switch back
                // to mail view + select that message.
                setSelectedContact(null);
                setShowContacts(false);
                setSelectedMessageId(mid);
              }}
              onToggleVip={async (c) => {
                try {
                  await api.setContactVip(c.id, !c.isVip);
                  const updated = { ...c, isVip: !c.isVip };
                  setContacts((cur) => cur.map((x) => x.id === c.id ? updated : x));
                  setSelectedContact(updated);
                } catch (e: any) { alert(String(e)); }
              }}
            />
          ) : selectedBody ? (
            <Reader
              msg={selectedBody}
              onReply={() => setCompose({ mode: "reply", msg: selectedBody })}
              onReplyAll={() => setCompose({ mode: "replyAll", msg: selectedBody })}
              onForward={() => setCompose({ mode: "forward", msg: selectedBody })}
              onMarkUnread={onMarkUnread}
            />
          ) : (
            <div className="mail-empty" style={{ padding: 40 }}>
              {showContacts ? "选一个联系人查看汇总" : "选一封邮件查看"}
            </div>
          )}
        </section>
      </div>

      {compose && (
        <ComposeModal
          accounts={accounts}
          defaultAccountId={selectedAccountId}
          replyTo={compose.mode === "new" ? null : { msg: compose.msg, mode: compose.mode, draftBody: compose.draftBody }}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            // Refresh the inbox so the sent thread surfaces.
            if (selectedAccountId) reloadMessages(selectedAccountId);
          }}
        />
      )}
    </div>
  );
}

function Reader({
  msg,
  onReply,
  onReplyAll,
  onForward,
  onMarkUnread,
}: {
  msg: MailMessageFull;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onMarkUnread: () => void;
}) {
  const senderLine = useMemo(() => {
    const from = msg.fromName ? `${msg.fromName} <${msg.fromEmail || ""}>` : msg.fromEmail || "";
    const to = msg.toEmails.map((a) => a.name ? `${a.name} <${a.email}>` : a.email).join(", ");
    return { from, to };
  }, [msg]);

  const htmlSrcDoc = msg.bodyHtml;

  return (
    <div className="reader-body">
      <div className="reader-actions">
        <button className="btn-ghost" onClick={onReply}>↩ 回复</button>
        <button className="btn-ghost" onClick={onReplyAll}>↩↩ 回复全部</button>
        <button className="btn-ghost" onClick={onForward}>↪ 转发</button>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={onMarkUnread}>● 标记未读</button>
      </div>
      <div className="reader-subj">{msg.subject || "(无主题)"}</div>
      <div className="reader-meta">
        <div><b>{senderLine.from}</b></div>
        <div className="reader-meta-row">收件人: {senderLine.to || "(无)"}</div>
        <div className="reader-meta-row">{fullDate(msg.dateMs)}</div>
        {msg.hasAttachments && <div className="reader-meta-row">📎 含附件</div>}
      </div>
      {htmlSrcDoc ? (
        <iframe className="reader-html" sandbox="" srcDoc={htmlSrcDoc} title={msg.subject || "email"} />
      ) : (
        <pre className="reader-text">{msg.bodyText || msg.snippet || ""}</pre>
      )}
    </div>
  );
}

/**
 * v0.10.3 — when the user clicks a contact in the contacts pane, the
 * reader pane shows this aggregated view: Pulse-analyzed brief items
 * about the contact + their recent mail thread. Pulse already produced
 * the items per-contact during the briefing pipeline; we just need to
 * surface them.
 */
function ContactDetail({
  contact,
  onClose,
  onOpenMessage,
  onToggleVip,
}: {
  contact: ContactRow;
  onClose: () => void;
  onOpenMessage: (messageId: string) => void;
  onToggleVip: (c: ContactRow) => void;
}) {
  const [mail, setMail] = useState<MailListItem[]>([]);
  const [briefs, setBriefs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [m, b] = await Promise.all([
          api.listContactMail(contact.accountId, contact.email, 30).catch(() => []),
          api.listContactBriefItems(contact.email).catch(() => []),
        ]);
        if (cancelled) return;
        setMail(m);
        setBriefs(b);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contact.id, contact.accountId, contact.email]);

  return (
    <div className="contact-detail">
      <div className="contact-detail-head">
        <div className="contact-detail-title">
          {contact.isVip && <span className="vip-star">★</span>}
          {contact.name || contact.email}
        </div>
        <div className="contact-detail-sub">
          {contact.email}
          {contact.organization && <> · {contact.organization}</>}
          <> · 互动 {contact.interactionCount} 次</>
          {contact.lastSeenMs && <> · 最近 {timeAgo(contact.lastSeenMs)}</>}
        </div>
        <div className="contact-detail-actions">
          <button className="btn-ghost" onClick={() => onToggleVip(contact)}>
            {contact.isVip ? "取消 VIP" : "★ 设为 VIP"}
          </button>
          <button className="btn-ghost" onClick={onClose}>关闭</button>
        </div>
      </div>

      {loading ? (
        <div className="mail-empty" style={{ padding: 40 }}>加载中…</div>
      ) : (
        <>
          {briefs.length > 0 && (
            <div className="contact-section">
              <div className="contact-section-label">
                ✦ AI 分析的重点事项 ({briefs.length})
              </div>
              {briefs.map((b) => (
                <div key={b.id} className={`contact-brief prio-${b.priority}`}>
                  <div className="contact-brief-head">
                    <span className={`prio-pill prio-${b.priority}`}>
                      {b.priority === "high" ? "高" : b.priority === "low" ? "低" : "中"}
                    </span>
                    <span className="contact-brief-title">{b.title}</span>
                  </div>
                  {b.summary && <div className="contact-brief-summary">{b.summary}</div>}
                  {b.why && (
                    <div className="contact-brief-why">
                      <span style={{ fontWeight: 600 }}>↗ </span>{b.why}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="contact-section">
            <div className="contact-section-label">
              📧 最近往来邮件 ({mail.length})
            </div>
            {mail.length === 0 ? (
              <div className="mail-empty" style={{ padding: 20 }}>暂无邮件</div>
            ) : (
              mail.map((m) => (
                <div
                  key={m.id}
                  className={`mail-item ${m.unread ? "unread" : ""}`}
                  onClick={() => onOpenMessage(m.id)}
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
                  <div className="mi-snip">{m.snippet}</div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
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
function fullDate(ms: number): string { return new Date(ms).toLocaleString("zh-CN"); }
function timeAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return "刚刚";
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 86400_000)} 天前`;
}
