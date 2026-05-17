import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import type { MailAccount, MailMessageFull } from "../lib/types";

interface Props {
  accounts: MailAccount[];
  defaultAccountId: string | null;
  /** If provided, the modal opens prefilled for a reply / reply-all / forward.
   *  Optional `draftBody` (from v0.9.1 BriefingFeed → AI reply draft handoff)
   *  overrides the default quoted-original prefill. */
  replyTo?: { msg: MailMessageFull; mode: "reply" | "replyAll" | "forward"; draftBody?: string } | null;
  onClose: () => void;
  onSent: () => void;
}

export function ComposeModal({ accounts, defaultAccountId, replyTo, onClose, onSent }: Props) {
  const [accountId, setAccountId] = useState<string>(
    replyTo?.msg.accountId || defaultAccountId || accounts[0]?.id || ""
  );

  const prefilled = useMemo(() => buildPrefill(replyTo, accounts), [replyTo, accounts]);
  const [to, setTo] = useState<string>(prefilled.to);
  const [cc, setCc] = useState<string>(prefilled.cc);
  const [bcc, setBcc] = useState<string>("");
  const [subject, setSubject] = useState<string>(prefilled.subject);
  // If an AI draft was passed in, put it ABOVE the standard quoted-original
  // block so the user can edit it before sending. Otherwise just use the
  // default quoted-only prefill.
  const initialBody = replyTo?.draftBody
    ? `${replyTo.draftBody}\n${prefilled.body}`
    : prefilled.body;
  const [body, setBody] = useState<string>(initialBody);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(prefilled.cc.length > 0);
  const [showBcc, setShowBcc] = useState(false);

  // Esc to close.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function pickAttachments() {
    const selected = await openDialog({ multiple: true, directory: false });
    if (!selected) return;
    const arr = Array.isArray(selected) ? selected : [selected];
    setAttachments((cur) => [...cur, ...arr]);
  }

  function removeAttachment(idx: number) {
    setAttachments((cur) => cur.filter((_, i) => i !== idx));
  }

  function parseAddrList(s: string): string[] {
    return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  }

  function buildInput() {
    // Forward != reply: only set replyToMessageId when this is actually a
    // reply / reply-all. Otherwise the BE routes forwards through Graph's
    // createReply (wrong: stitches into the original conversation) and
    // threads Gmail forwards into the original thread.
    const isReply = replyTo && (replyTo.mode === "reply" || replyTo.mode === "replyAll");
    return {
      accountId,
      to: parseAddrList(to),
      cc: parseAddrList(cc),
      bcc: parseAddrList(bcc),
      subject,
      bodyText: body,
      bodyHtml: null,
      attachmentPaths: attachments,
      replyToMessageId: isReply ? replyTo!.msg.id : null,
    };
  }

  async function onSend() {
    setError(null);
    if (!accountId) { setError("没选邮箱账号"); return; }
    if (parseAddrList(to).length === 0) { setError("收件人不能为空"); return; }
    if (!subject.trim() && !confirm("没有主题，要发吗？")) return;
    setSending(true);
    try {
      await api.sendMail(buildInput());
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: {
          title: "✓ 邮件已发送",
          kind: "done",
          actions: [{
            label: "查看邮件",
            primary: true,
            target: { view: "mail", accountId },
          }],
        },
      }));
      onSent();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function onSaveDraft() {
    setError(null);
    setSaving(true);
    try {
      const acct = accounts.find((a) => a.id === accountId);
      if (acct?.provider !== "gmail") {
        setError("草稿目前只支持 Gmail 账号");
        setSaving(false);
        return;
      }
      await api.saveMailDraft(buildInput(), null);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="compose-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="compose-modal">
        <div className="compose-head">
          <div className="compose-title">
            {replyTo ? (replyTo.mode === "forward" ? "转发邮件" : "回复邮件") : "新邮件"}
          </div>
          <button className="btn btn-ghost" onClick={onClose}>×</button>
        </div>

        <div className="compose-from">
          <span className="compose-label">发件:</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email} ({a.provider})
              </option>
            ))}
          </select>
        </div>

        <div className="compose-field">
          <span className="compose-label">收件人:</span>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="多个用逗号 / 分号分隔"
          />
          <div className="compose-toggles">
            {!showCc && <button className="btn-link" onClick={() => setShowCc(true)}>+ Cc</button>}
            {!showBcc && <button className="btn-link" onClick={() => setShowBcc(true)}>+ Bcc</button>}
          </div>
        </div>

        {showCc && (
          <div className="compose-field">
            <span className="compose-label">Cc:</span>
            <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} />
          </div>
        )}
        {showBcc && (
          <div className="compose-field">
            <span className="compose-label">Bcc:</span>
            <input type="text" value={bcc} onChange={(e) => setBcc(e.target.value)} />
          </div>
        )}

        <div className="compose-field">
          <span className="compose-label">主题:</span>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <textarea
          className="compose-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="写点东西…"
        />

        {attachments.length > 0 && (
          <div className="compose-attachments">
            {attachments.map((p, i) => (
              <span key={i} className="compose-att">
                📎 {basename(p)}
                <button className="att-rm" onClick={() => removeAttachment(i)}>×</button>
              </span>
            ))}
          </div>
        )}

        {error && <div className="compose-error">{error}</div>}

        <div className="compose-foot">
          <button className="btn btn-ghost" onClick={pickAttachments}>＋ 附件</button>
          <button className="btn btn-ghost" onClick={onSaveDraft} disabled={saving || sending}>
            {saving ? "保存中…" : "存草稿"}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={sending}>取消</button>
          <button className="btn btn-primary" onClick={onSend} disabled={sending}>
            {sending ? "发送中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildPrefill(
  replyTo: Props["replyTo"],
  accounts: MailAccount[]
): { to: string; cc: string; subject: string; body: string } {
  if (!replyTo) {
    return { to: "", cc: "", subject: "", body: "" };
  }
  const m = replyTo.msg;
  const ownAddrs = new Set(accounts.map((a) => a.email.toLowerCase()));
  const senderEmail = m.fromEmail || "";
  const senderLine = m.fromName ? `${m.fromName} <${senderEmail}>` : senderEmail;

  let to = "";
  let cc = "";
  if (replyTo.mode === "forward") {
    to = "";
  } else if (replyTo.mode === "reply") {
    to = senderEmail;
  } else {
    // replyAll: original sender + all original recipients minus our own.
    const targets = [senderEmail, ...m.toEmails.map((x) => x.email)]
      .filter((e) => e && !ownAddrs.has(e.toLowerCase()));
    const uniq = Array.from(new Set(targets));
    to = uniq.join(", ");
    cc = m.ccEmails
      .map((x) => x.email)
      .filter((e) => !ownAddrs.has(e.toLowerCase()))
      .join(", ");
  }

  const subj = m.subject || "";
  const subjPrefix = replyTo.mode === "forward" ? "Fwd: " : "Re: ";
  const subject = subj.toLowerCase().startsWith(subjPrefix.toLowerCase().trim())
    ? subj
    : subjPrefix + subj;

  const when = new Date(m.dateMs).toLocaleString("zh-CN");
  const quoted = (m.bodyText || m.snippet || "")
    .split("\n")
    .map((l) => "> " + l)
    .join("\n");
  const body = `\n\n----- 原邮件 -----\n${when} ${senderLine}\n\n${quoted}\n`;

  return { to, cc, subject, body };
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
