import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { MailAccount } from "../lib/types";
import type { ToastAction } from "../lib/notify";

export function CodeBlock({ children, topicId }: { children?: React.ReactNode; topicId?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const detected = detectCodeBlock(children);

  if (detected.language === "salmon-query") {
    return <SalmonQueryCard raw={detected.text} topicId={topicId} />;
  }

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

type SalmonQuery =
  | { kind: "mail.search"; query?: string; accountId?: string | null; limit?: number }
  | { kind: "mail.get"; messageId?: string }
  | { kind: "mail.recent"; accountId?: string | null; limit?: number }
  | { kind: "mail.contact"; accountId?: string | null; email?: string; limit?: number }
  | { kind: "calendar.list"; startLocal?: string; endLocal?: string; startMs?: number; endMs?: number }
  | { kind: "tasks.list"; accountId?: string | null; includeCompleted?: boolean };

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

interface SalmonActionExecution {
  message: string;
  actions?: ToastAction[];
}

function SalmonQueryCard({ raw, topicId }: { raw: string; topicId?: string }) {
  const parsed = useMemo(() => parseSalmonQuery(raw), [raw]);
  const key = useMemo(() => `salmon-query:${topicId || "none"}:${hashText(raw)}`, [raw, topicId]);
  const [status, setStatus] = useState<"pending" | "running" | "done" | "error">(() => {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key)) return "done";
    return "pending";
  });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!topicId || !parsed.ok || status !== "pending") return;
    let cancelled = false;
    setStatus("running");
    executeSalmonQuery(parsed.query)
      .then(async (result) => {
        if (cancelled) return;
        const content = formatQueryResult(parsed.query, result);
        sessionStorage.setItem(key, "1");
        setMessage(result.summary);
        setStatus("done");
        window.dispatchEvent(new CustomEvent("salmon:local-context", {
          detail: { topicId, content },
        }));
      })
      .catch((e: any) => {
        if (cancelled) return;
        setMessage(String(e?.message || e));
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [key, parsed, status, topicId]);

  const label = parsed.ok ? parsed.query.kind : "invalid";
  return (
    <div className="salmon-action-card">
      <div className="salmon-action-head">
        <span className="salmon-action-kicker">SalmonApp 本地查询</span>
        <span className="salmon-action-kind">{label}</span>
      </div>
      <div className="salmon-action-summary">
        {!parsed.ok
          ? parsed.error
          : status === "running"
            ? "正在读取本地缓存..."
            : status === "done"
              ? (message || "查询结果已回灌给当前 Topic。")
              : status === "error"
                ? `查询失败: ${message || "unknown error"}`
                : summarizeQuery(parsed.query)}
      </div>
      {parsed.ok && (
        <div className="salmon-action-details">
          <div className="salmon-action-row">
            <b>{summarizeQuery(parsed.query)}</b>
            <small>只读查询；不会发送、创建、修改或删除邮件 / 日历 / 待办。</small>
          </div>
        </div>
      )}
      {!topicId && <div className="salmon-action-error">缺少 Topic，无法回灌查询结果。</div>}
    </div>
  );
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
      const result = await executeSalmonAction(parsed.action, accountId);
      setDone(result.message);
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: result.message, kind: "done", actions: result.actions },
      }));
    } catch (e: any) {
      const msg = readableActionError(e);
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
      const result = await executeSalmonAction(action, accountId);
      setDone(result.message);
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: result.message, kind: "done", actions: result.actions },
      }));
    } catch (e: any) {
      const msg = readableActionError(e);
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

function parseSalmonQuery(raw: string): { ok: true; query: SalmonQuery } | { ok: false; error: string } {
  try {
    const value = JSON.parse(raw.trim());
    if (!value || typeof value !== "object" || typeof value.kind !== "string") {
      return { ok: false, error: "查询 JSON 必须包含 kind 字段。" };
    }
    if (!["mail.search", "mail.get", "mail.recent", "mail.contact", "calendar.list", "tasks.list"].includes(value.kind)) {
      return { ok: false, error: `暂不支持的查询: ${value.kind}` };
    }
    return { ok: true, query: value as SalmonQuery };
  } catch (e: any) {
    return { ok: false, error: `JSON 解析失败: ${String(e?.message || e)}` };
  }
}

function summarizeQuery(query: SalmonQuery): string {
  switch (query.kind) {
    case "mail.search":
      return `搜索本地邮件: ${query.query || "(空)"}`;
    case "mail.get":
      return `读取邮件详情: ${query.messageId || "(未指定)"}`;
    case "mail.recent":
      return `读取最近 ${query.limit || 20} 封邮件`;
    case "mail.contact":
      return `读取联系人邮件: ${query.email || "(未指定)"}`;
    case "calendar.list":
      return "读取日历事件窗口";
    case "tasks.list":
      return query.includeCompleted === false ? "读取未完成待办" : "读取待办列表";
  }
}

type SalmonQueryResult = { summary: string; data: any };

async function executeSalmonQuery(query: SalmonQuery): Promise<SalmonQueryResult> {
  switch (query.kind) {
    case "mail.search": {
      const q = query.query?.trim();
      if (!q) throw new Error("mail.search 缺少 query。");
      const rows = await api.searchMailMessages(q, query.accountId ?? null, query.limit || 10);
      return { summary: `找到 ${rows.length} 封匹配邮件`, data: rows };
    }
    case "mail.get": {
      if (!query.messageId) throw new Error("mail.get 缺少 messageId。");
      const msg = await api.getMailMessage(query.messageId);
      return { summary: "已读取 1 封邮件详情", data: msg };
    }
    case "mail.recent": {
      const accounts = await api.listMailAccounts();
      const target = query.accountId ? accounts.filter((a) => a.id === query.accountId) : accounts;
      const data = [];
      for (const account of target) {
        const rows = await api.listInboxMessages(account.id, query.limit || 20);
        data.push({ account, messages: rows });
      }
      const count = data.reduce((n, x) => n + x.messages.length, 0);
      return { summary: `读取最近邮件 ${count} 封`, data };
    }
    case "mail.contact": {
      const email = query.email?.trim();
      if (!email) throw new Error("mail.contact 缺少 email。");
      const accounts = await api.listMailAccounts();
      const target = query.accountId ? accounts.filter((a) => a.id === query.accountId) : accounts;
      const data = [];
      for (const account of target) {
        const rows = await api.listContactMail(account.id, email, query.limit || 20);
        data.push({ account, messages: rows });
      }
      const count = data.reduce((n, x) => n + x.messages.length, 0);
      return { summary: `读取 ${email} 相关邮件 ${count} 封`, data };
    }
    case "calendar.list": {
      const startMs = resolveLocalTime(query.startMs, query.startLocal, false);
      const endMs = resolveLocalTime(query.endMs, query.endLocal, false);
      if (!startMs || !endMs) throw new Error("calendar.list 需要 startLocal/startMs 和 endLocal/endMs。");
      const rows = await api.listCalendarEvents(startMs, endMs);
      return { summary: `读取日历事件 ${rows.length} 条`, data: rows };
    }
    case "tasks.list": {
      const rows = await api.listTasks(query.accountId ?? null, query.includeCompleted ?? true);
      return { summary: `读取待办 ${rows.length} 条`, data: rows };
    }
  }
}

function formatQueryResult(query: SalmonQuery, result: SalmonQueryResult): string {
  return [
    `查询: ${summarizeQuery(query)}`,
    `结果: ${result.summary}`,
    "",
    "```json",
    JSON.stringify(compactQueryData(result.data), null, 2),
    "```",
  ].join("\n");
}

function compactQueryData(value: any): any {
  if (Array.isArray(value)) return value.slice(0, 20).map(compactQueryData);
  if (!value || typeof value !== "object") return value;
  if ("bodyText" in value || "bodyHtml" in value) {
    return {
      ...value,
      bodyText: truncate(String(value.bodyText || ""), 6000),
      bodyHtml: value.bodyHtml ? "[html omitted]" : null,
    };
  }
  if ("messages" in value && Array.isArray(value.messages)) {
    return { ...value, messages: value.messages.slice(0, 20).map(compactQueryData) };
  }
  return value;
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

async function executeSalmonAction(action: SalmonAction, accountId: string): Promise<SalmonActionExecution> {
  switch (action.kind) {
    case "tasks.create": {
      const items = action.items || [];
      if (items.length === 0) throw new Error("没有待办条目。");
      const actions: ToastAction[] = [];
      for (const item of items) {
        const title = item.title?.trim();
        if (!title) throw new Error("待办标题不能为空。");
        const task = await api.createTask({
          accountId,
          title,
          notes: item.notes?.trim() || null,
          dueMs: resolveLocalTime(item.dueMs, item.dueLocal, true),
          sourceKind: "chat",
          sourceBriefItemId: null,
        });
        actions.push({
          label: "查看待办",
          primary: actions.length === 0,
          target: { view: "tasks", taskId: task.id, accountId: task.accountId },
        });
      }
      return { message: `已创建 ${items.length} 个待办`, actions };
    }
    case "calendar.create": {
      const events = calendarItems(action);
      if (events.length === 0) throw new Error("没有日历事件。");
      const actions: ToastAction[] = [];
      for (const event of events) {
        const title = event.title?.trim();
        if (!title) throw new Error("日历标题不能为空。");
        const allDay = !!event.allDay;
        const startMs = resolveLocalTime(event.startMs, event.startLocal, allDay);
        let endMs = resolveLocalTime(event.endMs, event.endLocal, allDay);
        if (!startMs) throw new Error(`日历事件缺少开始时间: ${title}`);
        if (!endMs) endMs = allDay ? startMs : startMs + 60 * 60 * 1000;
        const created = await api.createCalendarEvent({
          accountId,
          title,
          startMs,
          endMs,
          allDay,
          location: event.location?.trim() || null,
        });
        actions.push({
          label: "查看日历",
          primary: actions.length === 0,
          target: { view: "calendar", eventId: created.id, accountId, startMs },
        });
      }
      return { message: `已创建 ${events.length} 个日历事件`, actions };
    }
    case "mail.draft": {
      const draft = action.draft;
      if (!draft) throw new Error("缺少邮件草稿。");
      await api.saveMailDraft(toComposeInput(draft, accountId), null);
      return {
        message: "已保存邮件草稿",
        actions: [{ label: "查看邮件", primary: true, target: { view: "mail", accountId } }],
      };
    }
    case "mail.send": {
      const mail = action.mail;
      if (!mail) throw new Error("缺少邮件内容。");
      await api.sendMail(toComposeInput(mail, accountId));
      return {
        message: "已发送邮件",
        actions: [{ label: "查看邮件", primary: true, target: { view: "mail", accountId } }],
      };
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

function readableActionError(error: unknown): string {
  const text = String(error || "");
  if (
    text.includes("Google Tasks API has not been used") ||
    text.includes("SERVICE_DISABLED") ||
    text.includes("accessNotConfigured")
  ) {
    return "Google Tasks API 未启用。SalmonApp 会把待办先保存到本地，等账号/API 配好后再同步。";
  }
  if (text.length <= 260) return text;
  return `${text.slice(0, 257)}...`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
