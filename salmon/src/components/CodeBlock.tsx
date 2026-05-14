import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { MailAccount } from "../lib/types";

export function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const detected = detectCodeBlock(children);

  if (detected.language === "salmon-action") {
    return <SalmonActionCard raw={detected.text} />;
  }

  const onCopy = async () => {
    const text = ref.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="codeblock">
      <button
        className={`codeblock-copy${copied ? " copied" : ""}`}
        onClick={onCopy}
        title="复制到剪贴板"
        aria-label="复制代码块"
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

type SalmonAction =
  | { kind: "tasks.create"; items?: TaskActionItem[]; requiresConfirmation?: boolean }
  | { kind: "calendar.create"; event?: CalendarActionItem; events?: CalendarActionItem[]; requiresConfirmation?: boolean }
  | { kind: "mail.draft"; draft?: MailActionItem; requiresConfirmation?: boolean }
  | { kind: "mail.send"; mail?: MailActionItem; requiresConfirmation?: boolean };

interface TaskActionItem {
  title?: string;
  notes?: string | null;
  dueLocal?: string | null;
  dueMs?: number | null;
}

interface CalendarActionItem {
  title?: string;
  startLocal?: string | null;
  endLocal?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  allDay?: boolean | null;
  location?: string | null;
}

interface MailActionItem {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string | null;
  replyToMessageId?: string | null;
}

function SalmonActionCard({ raw }: { raw: string }) {
  const parsed = useMemo(() => parseSalmonAction(raw), [raw]);
  if (parsed.ok && (parsed.action.kind === "mail.send" || parsed.action.kind === "mail.draft")) {
    return <MailActionCard action={parsed.action} />;
  }

  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listMailAccounts()
      .then((rows) => {
        if (cancelled) return;
        setAccounts(rows);
        setAccountId((cur) => cur || rows[0]?.id || "");
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  }, []);

  const summary = parsed.ok ? summarizeAction(parsed.action) : "无法识别动作";
  const canRun = parsed.ok && !!accountId && !busy && !done;

  const onConfirm = async () => {
    if (!parsed.ok) return;
    setBusy(true);
    setError(null);
    try {
      const message = await executeSalmonAction(parsed.action, accountId);
      setDone(message);
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: message, kind: "done" },
      }));
    } catch (e: any) {
      const msg = String(e);
      setError(msg);
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: "动作执行失败", body: msg, kind: "error" },
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="salmon-action-card">
      <div className="salmon-action-head">
        <span className="salmon-action-kicker">SalmonApp 本地动作</span>
        <span className="salmon-action-kind">{parsed.ok ? parsed.action.kind : "invalid"}</span>
      </div>
      <div className="salmon-action-summary">{summary}</div>

      {parsed.ok && (
        <div className="salmon-action-details">
          {renderActionDetails(parsed.action)}
        </div>
      )}

      {!parsed.ok && <div className="salmon-action-error">{parsed.error}</div>}
      {parsed.ok && accounts.length === 0 && !error && (
        <div className="salmon-action-error">没有可用账号。请先登录邮件/日历/待办账号。</div>
      )}
      {parsed.ok && accounts.length > 0 && (
        <label className="salmon-action-account">
          <span>执行账号</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={busy || !!done}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email} ({a.provider})</option>
            ))}
          </select>
        </label>
      )}
      {error && <div className="salmon-action-error">{error}</div>}
      {done && <div className="salmon-action-done">{done}</div>}
      <div className="salmon-action-actions">
        <button className="btn primary" onClick={onConfirm} disabled={!canRun}>
          {busy ? "执行中..." : done ? "已执行" : "确认执行"}
        </button>
      </div>
    </div>
  );
}

function MailActionCard({ action }: { action: Extract<SalmonAction, { kind: "mail.send" | "mail.draft" }> }) {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listMailAccounts()
      .then((rows) => {
        if (cancelled) return;
        setAccounts(rows);
        setAccountId((cur) => cur || rows[0]?.id || "");
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  }, []);

  const mail = action.kind === "mail.send" ? action.mail : action.draft;
  const isSend = action.kind === "mail.send";
  const canRun = !!mail && !!accountId && !busy && !done;
  const title = isSend ? "Ready to send email" : "Ready to save draft";
  const buttonLabel = isSend ? "Send Email" : "Save Draft";

  const onConfirm = async () => {
    if (!mail) return;
    setBusy(true);
    setError(null);
    try {
      const message = await executeSalmonAction(action, accountId);
      setDone(message);
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: message, kind: "done" },
      }));
    } catch (e: any) {
      const msg = String(e);
      setError(msg);
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: isSend ? "邮件发送失败" : "草稿保存失败", body: msg, kind: "error" },
      }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mail-action-card">
      <div className="mail-action-head">
        <div>
          <div className="mail-action-title">{title}</div>
          <div className="mail-action-subtitle">
            Review the details below. SalmonApp will use the selected local account only after confirmation.
          </div>
        </div>
        <span className="mail-action-pill">{isSend ? "mail.send" : "mail.draft"}</span>
      </div>

      <div className="mail-action-grid">
        <MailMeta label="Subject" value={mail?.subject || "(No subject)"} strong />
        <MailMeta label="To" value={formatRecipients(mail?.to)} />
        {(mail?.cc || []).length > 0 && <MailMeta label="Cc" value={formatRecipients(mail?.cc)} />}
        {(mail?.bcc || []).length > 0 && <MailMeta label="Bcc" value={formatRecipients(mail?.bcc)} />}
      </div>

      <div className="mail-action-body">
        <div className="mail-action-body-label">Message</div>
        <div className="mail-action-body-text">{mail?.bodyText?.trim() || "(Empty body)"}</div>
      </div>

      {accounts.length === 0 && !error && (
        <div className="salmon-action-error">没有可用邮件账号。请先登录邮件账号。</div>
      )}
      {accounts.length > 0 && (
        <label className="mail-action-account">
          <span>From</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={busy || !!done}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email} ({a.provider})</option>
            ))}
          </select>
        </label>
      )}
      {error && <div className="salmon-action-error">{error}</div>}
      {done && <div className="salmon-action-done">{done}</div>}
      <div className="mail-action-actions">
        <button className="btn primary mail-send-btn" onClick={onConfirm} disabled={!canRun}>
          {busy ? (isSend ? "Sending..." : "Saving...") : done ? "Done" : buttonLabel}
        </button>
      </div>
    </div>
  );
}

function MailMeta({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mail-action-meta">
      <span>{label}</span>
      <b className={strong ? "strong" : undefined}>{value}</b>
    </div>
  );
}

function detectCodeBlock(children: React.ReactNode): { language: string | null; text: string } {
  const child = React.Children.toArray(children)[0] as any;
  if (!React.isValidElement(child)) {
    return { language: null, text: textFromNode(children) };
  }
  const props = child.props as { className?: string; children?: React.ReactNode };
  const className = String(props.className || "");
  const match = className.match(/language-([a-z0-9_-]+)/i);
  return {
    language: match?.[1]?.toLowerCase() || null,
    text: textFromNode(props.children),
  };
}

function textFromNode(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (React.isValidElement(node)) return textFromNode((node.props as any).children);
  return "";
}

function parseSalmonAction(raw: string): { ok: true; action: SalmonAction } | { ok: false; error: string } {
  try {
    const value = JSON.parse(raw.trim());
    if (!value || typeof value !== "object" || typeof value.kind !== "string") {
      return { ok: false, error: "动作 JSON 必须包含 kind 字段。" };
    }
    if (!["tasks.create", "calendar.create", "mail.draft", "mail.send"].includes(value.kind)) {
      return { ok: false, error: `暂不支持的动作: ${value.kind}` };
    }
    return { ok: true, action: value as SalmonAction };
  } catch (e: any) {
    return { ok: false, error: `JSON 解析失败: ${String(e?.message || e)}` };
  }
}

function summarizeAction(action: SalmonAction): string {
  switch (action.kind) {
    case "tasks.create":
      return `准备创建 ${(action.items || []).length || 1} 个待办，确认后由 SalmonApp 本地接口执行。`;
    case "calendar.create":
      return `准备创建 ${calendarItems(action).length || 1} 个日历事件，确认后由 SalmonApp 本地接口执行。`;
    case "mail.draft":
      return "准备保存邮件草稿，确认后由 SalmonApp 本地接口执行。";
    case "mail.send":
      return "准备发送邮件。请仔细核对收件人、主题和正文，确认后才会发送。";
  }
}

function renderActionDetails(action: SalmonAction) {
  if (action.kind === "tasks.create") {
    return (
      <>
        {(action.items || []).map((item, i) => (
          <div className="salmon-action-row" key={i}>
            <b>{item.title || "未命名待办"}</b>
            {item.dueLocal && <span>截止 {item.dueLocal}</span>}
            {item.notes && <small>{item.notes}</small>}
          </div>
        ))}
      </>
    );
  }
  if (action.kind === "calendar.create") {
    return (
      <>
        {calendarItems(action).map((event, i) => (
          <div className="salmon-action-row" key={i}>
            <b>{event.title || "未命名日程"}</b>
            <span>{event.startLocal || formatMs(event.startMs)} - {event.endLocal || formatMs(event.endMs)}</span>
            {event.location && <small>{event.location}</small>}
          </div>
        ))}
      </>
    );
  }
  const mail = action.kind === "mail.draft" ? action.draft : action.mail;
  return (
    <div className="salmon-action-row">
      <b>{mail?.subject || "无主题"}</b>
      <span>{(mail?.to || []).join(", ") || "未填写收件人"}</span>
      {mail?.bodyText && <small>{truncate(mail.bodyText, 160)}</small>}
    </div>
  );
}

async function executeSalmonAction(action: SalmonAction, accountId: string): Promise<string> {
  switch (action.kind) {
    case "tasks.create": {
      const items = action.items || [];
      if (items.length === 0) throw new Error("没有待办条目。");
      for (const item of items) {
        const title = item.title?.trim();
        if (!title) throw new Error("待办标题不能为空。");
        await api.createTask({
          accountId,
          title,
          notes: item.notes?.trim() || null,
          dueMs: resolveLocalTime(item.dueMs, item.dueLocal, true),
          sourceKind: "chat",
          sourceBriefItemId: null,
        });
      }
      return `已创建 ${items.length} 个待办`;
    }
    case "calendar.create": {
      const events = calendarItems(action);
      if (events.length === 0) throw new Error("没有日历事件。");
      for (const event of events) {
        const title = event.title?.trim();
        if (!title) throw new Error("日历标题不能为空。");
        const allDay = !!event.allDay;
        const startMs = resolveLocalTime(event.startMs, event.startLocal, allDay);
        let endMs = resolveLocalTime(event.endMs, event.endLocal, allDay);
        if (!startMs) throw new Error(`日历事件缺少开始时间: ${title}`);
        if (!endMs) endMs = allDay ? startMs : startMs + 60 * 60 * 1000;
        await api.createCalendarEvent({
          accountId,
          title,
          startMs,
          endMs,
          allDay,
          location: event.location?.trim() || null,
        });
      }
      return `已创建 ${events.length} 个日历事件`;
    }
    case "mail.draft": {
      const draft = action.draft;
      if (!draft) throw new Error("缺少邮件草稿。");
      await api.saveMailDraft(toComposeInput(draft, accountId), null);
      return "已保存邮件草稿";
    }
    case "mail.send": {
      const mail = action.mail;
      if (!mail) throw new Error("缺少邮件内容。");
      await api.sendMail(toComposeInput(mail, accountId));
      return "已发送邮件";
    }
  }
}

function calendarItems(action: Extract<SalmonAction, { kind: "calendar.create" }>): CalendarActionItem[] {
  if (Array.isArray(action.events)) return action.events;
  return action.event ? [action.event] : [];
}

function toComposeInput(mail: MailActionItem, accountId: string) {
  return {
    accountId,
    to: mail.to || [],
    cc: mail.cc || [],
    bcc: mail.bcc || [],
    subject: mail.subject || "",
    bodyText: mail.bodyText || "",
    bodyHtml: mail.bodyHtml || null,
    attachmentPaths: [],
    replyToMessageId: mail.replyToMessageId || null,
  };
}

function resolveLocalTime(ms?: number | null, local?: string | null, dateOnlyAtMidnight = false): number | null {
  if (typeof ms === "number" && Number.isFinite(ms)) return ms;
  if (!local) return null;
  const trimmed = local.trim();
  if (!trimmed) return null;
  const isoLike = dateOnlyAtMidnight && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00`
    : trimmed.replace(" ", "T");
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function formatMs(ms?: number | null): string {
  if (!ms) return "未填写时间";
  return new Date(ms).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

function formatRecipients(values?: string[]): string {
  const rows = (values || []).map((v) => v.trim()).filter(Boolean);
  return rows.length > 0 ? rows.join(", ") : "(Not specified)";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
