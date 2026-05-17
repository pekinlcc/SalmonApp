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
    return <SalmonActionCard raw={detected.text} topicId={topicId} />;
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
  | { kind: "tasks.update"; taskId?: string; patch?: TaskUpdatePatch; requiresConfirmation?: boolean }
  | { kind: "tasks.delete"; taskId?: string; requiresConfirmation?: boolean }
  | { kind: "tasks.toggle"; taskId?: string; completed?: boolean; requiresConfirmation?: boolean }
  | { kind: "calendar.create"; event?: CalendarActionItem; events?: CalendarActionItem[]; requiresConfirmation?: boolean }
  | { kind: "calendar.update"; eventId?: string; accountId?: string | null; patch?: CalendarUpdatePatch; requiresConfirmation?: boolean }
  | { kind: "calendar.delete"; eventId?: string; accountId?: string | null; requiresConfirmation?: boolean }
  | { kind: "mail.draft"; draft?: MailActionItem; requiresConfirmation?: boolean }
  | { kind: "mail.send"; mail?: MailActionItem; requiresConfirmation?: boolean }
  | { kind: "mail.reply"; mail?: MailActionItem; requiresConfirmation?: boolean }
  | { kind: "mail.forward"; messageId?: string; to?: string[]; cc?: string[]; bodyPrefix?: string | null; requiresConfirmation?: boolean }
  | { kind: "mail.mark_read"; messageId?: string; read?: boolean; requiresConfirmation?: boolean }
  | { kind: "mail.star"; messageId?: string; starred?: boolean; requiresConfirmation?: boolean }
  | { kind: "mail.archive"; messageId?: string; requiresConfirmation?: boolean }
  | { kind: "contacts.vip"; contactId?: string; vip?: boolean; requiresConfirmation?: boolean }
  | { kind: "contacts.note"; contactId?: string; note?: string | null; requiresConfirmation?: boolean }
  | { kind: "workflow"; title?: string; steps?: SalmonAction[]; requiresConfirmation?: boolean };

type SalmonQuery =
  | { kind: "mail.search"; query?: string; accountId?: string | null; limit?: number }
  | { kind: "mail.get"; messageId?: string }
  | { kind: "mail.recent"; accountId?: string | null; limit?: number }
  | { kind: "mail.contact"; accountId?: string | null; email?: string; limit?: number }
  | { kind: "mail.thread"; threadId?: string; limit?: number }
  | { kind: "contacts.detail"; email?: string }
  | { kind: "calendar.list"; startLocal?: string; endLocal?: string; startMs?: number; endMs?: number }
  | { kind: "tasks.list"; accountId?: string | null; includeCompleted?: boolean };

interface TaskActionItem {
  title?: string;
  notes?: string | null;
  dueLocal?: string | null;
  dueMs?: number | null;
}

interface TaskUpdatePatch {
  title?: string | null;
  notes?: string | null;
  dueLocal?: string | null;
  dueMs?: number | null;
  completed?: boolean | null;
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

interface CalendarUpdatePatch {
  title?: string | null;
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
    // v1.15.0: bump the per-topic "engine anticipating" counter so the
    // chat stream's typing dots stay on through the API-call window.
    // Without this, the engine's `exited` event for the previous turn
    // fires before we dispatch salmon:local-context for the next turn,
    // leaving a multi-second gap where the user sees nothing animating
    // and assumes the AI has stopped.
    window.dispatchEvent(new CustomEvent("salmon:anticipate-engine", {
      detail: { topicId, delta: 1 },
    }));
    let anticipateOpen = true;
    const closeAnticipate = () => {
      if (!anticipateOpen) return;
      anticipateOpen = false;
      window.dispatchEvent(new CustomEvent("salmon:anticipate-engine", {
        detail: { topicId, delta: -1 },
      }));
    };
    executeSalmonQuery(parsed.query)
      .then(async (result) => {
        if (cancelled) { closeAnticipate(); return; }
        const content = formatQueryResult(parsed.query, result);
        sessionStorage.setItem(key, "1");
        setMessage(result.summary);
        setStatus("done");
        // Dispatch local-context BEFORE closing anticipate so App's
        // continueWithLocalContext sets busy=true within the same tick
        // and we never visibly drop to zero. Close happens just after
        // — by then the engine event handler has already taken over.
        window.dispatchEvent(new CustomEvent("salmon:local-context", {
          detail: { topicId, content },
        }));
        closeAnticipate();
      })
      .catch((e: any) => {
        if (cancelled) { closeAnticipate(); return; }
        setMessage(String(e?.message || e));
        setStatus("error");
        closeAnticipate();
      });
    return () => {
      cancelled = true;
      // Unmount mid-run still must decrement so the counter doesn't leak.
      closeAnticipate();
    };
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

function SalmonActionCard({ raw, topicId }: { raw: string; topicId?: string }) {
  const parsed = useMemo(() => parseSalmonAction(raw), [raw]);
  if (
    parsed.ok &&
    (parsed.action.kind === "mail.send"
      || parsed.action.kind === "mail.draft"
      || parsed.action.kind === "mail.reply")
  ) {
    return <MailActionCard action={parsed.action} topicId={topicId} />;
  }

  const persistKey = useMemo(() => `${topicId || "none"}:${hashText(raw)}`, [topicId, raw]);
  const persisted = useMemo(() => loadExecutedAction(persistKey), [persistKey]);

  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(persisted?.message || null);
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
      markExecutedAction(persistKey, result);
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
        <button className="btn btn-sm btn-primary" onClick={onConfirm} disabled={!canRun}>
          {busy ? "执行中..." : done ? "已执行" : "确认执行"}
        </button>
      </div>
    </div>
  );
}

function MailActionCard({
  action,
  topicId,
}: {
  action: Extract<SalmonAction, { kind: "mail.send" | "mail.draft" | "mail.reply" }>;
  topicId?: string;
}) {
  // Persist execution state so navigating away and back doesn't expose a
  // re-clickable "Send Email" button after the email was already sent.
  // The key includes both the topic and the raw action content so two
  // distinct send-attempts in different conversations don't collide.
  const persistKey = useMemo(
    () => `${topicId || "none"}:${hashText(JSON.stringify(action))}`,
    [topicId, action]
  );
  const persisted = useMemo(() => loadExecutedAction(persistKey), [persistKey]);

  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(persisted?.message || null);
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

  const mail = action.kind === "mail.draft" ? action.draft : action.mail;
  const isSend = action.kind === "mail.send" || action.kind === "mail.reply";
  const canRun = !!mail && !!accountId && !busy && !done;
  const title = action.kind === "mail.reply"
    ? "Ready to send reply"
    : isSend
      ? "Ready to send email"
      : "Ready to save draft";
  const buttonLabel = action.kind === "mail.reply"
    ? "Send Reply"
    : isSend
      ? "Send Email"
      : "Save Draft";

  const onConfirm = async () => {
    if (!mail) return;
    setBusy(true);
    setError(null);
    try {
      const result = await executeSalmonAction(action, accountId);
      setDone(result.message);
      markExecutedAction(persistKey, result);
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
        <span className="mail-action-pill">{action.kind}</span>
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
        <button className="btn btn-primary" onClick={onConfirm} disabled={!canRun}>
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

const ACTION_KINDS = new Set([
  "tasks.create",
  "tasks.update",
  "tasks.delete",
  "tasks.toggle",
  "calendar.create",
  "calendar.update",
  "calendar.delete",
  "mail.draft",
  "mail.send",
  "mail.reply",
  "mail.forward",
  "mail.mark_read",
  "mail.star",
  "mail.archive",
  "contacts.vip",
  "contacts.note",
  "workflow",
]);

const QUERY_KINDS = new Set([
  "mail.search",
  "mail.get",
  "mail.recent",
  "mail.contact",
  "mail.thread",
  "contacts.detail",
  "calendar.list",
  "tasks.list",
]);

function parseSalmonAction(raw: string): { ok: true; action: SalmonAction } | { ok: false; error: string } {
  try {
    const value = JSON.parse(raw.trim());
    if (!value || typeof value !== "object" || typeof value.kind !== "string") {
      return { ok: false, error: "动作 JSON 必须包含 kind 字段。" };
    }
    if (!ACTION_KINDS.has(value.kind)) {
      return { ok: false, error: `暂不支持的动作: ${value.kind}` };
    }
    if (value.kind === "workflow") {
      const steps = Array.isArray(value.steps) ? value.steps : [];
      for (const step of steps) {
        if (!step || typeof step !== "object" || typeof step.kind !== "string" || !ACTION_KINDS.has(step.kind)) {
          return { ok: false, error: `workflow 含未识别的子动作: ${step?.kind ?? "(missing)"}` };
        }
        if (step.kind === "workflow") {
          return { ok: false, error: "workflow 不能嵌套 workflow。" };
        }
      }
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
    if (!QUERY_KINDS.has(value.kind)) {
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
    case "mail.thread":
      return `读取 thread: ${query.threadId || "(未指定)"}`;
    case "contacts.detail":
      return `读取联系人 30 天 360: ${query.email || "(未指定)"}`;
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
    case "mail.thread": {
      const threadId = query.threadId?.trim();
      if (!threadId) throw new Error("mail.thread 缺少 threadId。");
      const rows = await api.listThreadMail(threadId, query.limit || 20);
      return { summary: `读取 thread ${threadId} 共 ${rows.length} 封`, data: rows };
    }
    case "contacts.detail": {
      const email = query.email?.trim();
      if (!email) throw new Error("contacts.detail 缺少 email。");
      const bundle = await api.getContactRoostBundle(email);
      if (!bundle) {
        return { summary: `本地未找到 ${email} 的 30 天聚合`, data: null };
      }
      return { summary: `读取 ${email} 30 天聚合（邮件 ${bundle.messages.length} 封, 事件 ${bundle.events.length} 个）`, data: bundle };
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
  // v1.13.0: replace the raw JSON dump with per-kind markdown rendering.
  // The CLI used to receive (and the chat used to display) a giant
  // {"id":"...","accountId":"...",...} blob for every query result; that
  // was technically faithful but visually a debugger dump. Markdown lists
  // are easier for both the user and the next LLM turn to scan, and they
  // still preserve the ids the agent needs for follow-up actions.
  const header = `**${summarizeQuery(query)}** · ${result.summary}`;
  const body = renderQueryBody(query, result.data);
  return [header, "", body].join("\n");
}

function renderQueryBody(query: SalmonQuery, data: any): string {
  switch (query.kind) {
    case "mail.search":
    case "mail.recent":
    case "mail.contact":
    case "mail.thread":
      return renderMailListBody(query, data);
    case "mail.get":
      return renderMailDetailBody(data);
    case "contacts.detail":
      return renderContactDetailBody(query, data);
    case "calendar.list":
      return renderEventListBody(data);
    case "tasks.list":
      return renderTaskListBody(data);
  }
}

function renderMailListBody(query: SalmonQuery, data: any): string {
  // mail.recent and mail.contact return [{account, messages: []}],
  // others return MailListItem[] directly. Flatten to a single list.
  let rows: any[] = [];
  if (Array.isArray(data)) {
    if (data.length > 0 && data[0] && typeof data[0] === "object" && "messages" in data[0]) {
      for (const group of data) {
        for (const m of group.messages || []) rows.push(m);
      }
    } else {
      rows = data;
    }
  }
  if (rows.length === 0) {
    return emptyMailFallback(query);
  }
  const lines = rows.slice(0, 30).map((m, i) => {
    const date = m.dateMs ? formatLocal(m.dateMs) : "(无日期)";
    const sender = m.fromName?.trim() || m.fromEmail?.trim() || "(unknown)";
    const subject = (m.subject || "(无主题)").trim();
    const snippet = (m.snippet || "").trim().replace(/\s+/g, " ").slice(0, 120);
    const flags = [
      m.unread ? "未读" : null,
      m.starred ? "★" : null,
      m.hasAttachments ? "📎" : null,
    ].filter(Boolean).join(" ");
    return `${i + 1}. **${subject}** — ${sender} · ${date}${flags ? " · " + flags : ""}\n   id: \`${m.id}\` · ${snippet}`;
  });
  return lines.join("\n");
}

function renderMailDetailBody(m: any): string {
  if (!m || typeof m !== "object") return "_(无邮件详情)_";
  const date = m.dateMs ? formatLocal(m.dateMs) : "(无日期)";
  const sender = m.fromName?.trim()
    ? `${m.fromName.trim()} <${m.fromEmail || ""}>`
    : (m.fromEmail || "(unknown)");
  const recipients = formatEmails(m.toEmails);
  const ccs = formatEmails(m.ccEmails);
  const body = truncate(String(m.bodyText || "").replace(/\r\n/g, "\n").trim(), 4000) || "_(无正文)_";
  const lines = [
    `- **主题**: ${(m.subject || "(无主题)").trim()}`,
    `- **发件人**: ${sender}`,
    recipients ? `- **收件人**: ${recipients}` : null,
    ccs ? `- **抄送**: ${ccs}` : null,
    `- **时间**: ${date}`,
    `- **id**: \`${m.id}\`${m.threadId ? ` · thread \`${m.threadId}\`` : ""}`,
    "",
    "正文:",
    body.split("\n").map((l: string) => `> ${l}`).join("\n"),
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

function formatEmails(emails: any): string {
  if (!Array.isArray(emails) || emails.length === 0) return "";
  return emails
    .map((a: any) => a?.name ? `${a.name} <${a.email}>` : (a?.email || ""))
    .filter(Boolean)
    .join(", ");
}

function renderContactDetailBody(query: SalmonQuery, bundle: any): string {
  const email = (query.kind === "contacts.detail" ? query.email : null) || "(unknown)";
  if (!bundle || typeof bundle !== "object") {
    return `本地没有 ${email} 的 30 天聚合。可能原因:\n` + threeFactorFallback();
  }
  const lines: string[] = [];
  lines.push(`**${bundle.displayName?.trim() || email}**${bundle.isVip ? " · VIP" : ""} · 30 天互动 ${bundle.interactionCount || 0} 次 · 最近 ${bundle.lastSeenMs ? formatLocal(bundle.lastSeenMs) : "无"}`);
  const msgs = Array.isArray(bundle.messages) ? bundle.messages : [];
  if (msgs.length > 0) {
    lines.push("");
    lines.push(`最近邮件（${msgs.length} 封${bundle.omittedMessageCount ? `, 省略 ${bundle.omittedMessageCount} 封` : ""}）:`);
    for (const [i, m] of msgs.slice(0, 12).entries()) {
      const dir = m.fromMe ? "→" : "←";
      const subject = (m.subject || "(无主题)").trim();
      const snippet = (m.snippet || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const date = m.dateMs ? formatLocal(m.dateMs) : "";
      lines.push(`${i + 1}. ${dir} ${date} · **${subject}** — ${snippet}\n   id: \`${m.id}\``);
    }
  }
  const events = Array.isArray(bundle.events) ? bundle.events : [];
  if (events.length > 0) {
    lines.push("");
    lines.push(`共同日历事件（${events.length}）:`);
    for (const e of events.slice(0, 10)) {
      const when = e.allDay ? formatLocalDate(e.startMs) : formatLocal(e.startMs);
      lines.push(`- ${when} · **${(e.title || "(无标题)").trim()}**${e.location ? " @ " + e.location : ""}\n  id: \`${e.id}\``);
    }
  }
  if (msgs.length === 0 && events.length === 0) {
    lines.push("");
    lines.push("本地 30 天内没有跟这个联系人的邮件或共同日程。");
    lines.push(threeFactorFallback());
  }
  return lines.join("\n");
}

function renderEventListBody(data: any): string {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    return "本地日历窗口里没事件。可能原因:\n" + threeFactorFallback();
  }
  const lines = rows.slice(0, 30).map((e: any, i: number) => {
    const start = e.allDay ? formatLocalDate(e.startMs) : formatLocal(e.startMs);
    const end = e.allDay ? "" : ` - ${formatLocal(e.endMs).slice(-5)}`;
    const title = (e.title || "(无标题)").trim();
    const attendees = Array.isArray(e.attendees) && e.attendees.length > 0
      ? ` · 与会 ${e.attendees.slice(0, 4).map((a: any) => a.name || a.email).join(", ")}${e.attendees.length > 4 ? "..." : ""}`
      : "";
    return `${i + 1}. **${start}${end}** · ${title}${e.location ? " @ " + e.location : ""}${attendees}\n   id: \`${e.id}\``;
  });
  return lines.join("\n");
}

function renderTaskListBody(data: any): string {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    return "本地待办列表为空。可能原因:\n" + threeFactorFallback();
  }
  const now = Date.now();
  const lines = rows.slice(0, 30).map((t: any, i: number) => {
    const due = t.dueMs ? formatLocal(t.dueMs) : "无截止";
    const overdue = t.dueMs && t.dueMs < now ? "⚠ 已逾期 · " : "";
    const completed = t.completed ? "✓ " : "";
    const notes = t.notes ? ` · ${String(t.notes).slice(0, 60)}` : "";
    return `${i + 1}. ${completed}${overdue}**${t.title || "(无标题)"}** · 截止 ${due}${notes}\n   id: \`${t.id}\``;
  });
  return lines.join("\n");
}

function emptyMailFallback(query: SalmonQuery): string {
  const queryText = query.kind === "mail.search" && (query as any).query
    ? `（查 "${(query as any).query}"）`
    : "";
  return `本地缓存里没找到匹配邮件${queryText}。可能原因:\n${threeFactorFallback()}`;
}

function threeFactorFallback(): string {
  return [
    "- (a) 邮件账号未登录 / 未同步 — 设置里检查 Gmail/Outlook 账号；",
    "- (b) 邮件在你问的时间窗外 — 本地缓存可能没拉过那段历史；",
    "- (c) 关键词不在本地索引 — 试一下发件人邮箱、主题片段或具体词。",
    "",
    "让用户挑一个核对再继续，不要直接结束。",
  ].join("\n");
}

function formatLocal(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocalDate(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("zh-CN");
}

function summarizeAction(action: SalmonAction): string {
  switch (action.kind) {
    case "tasks.create":
      return `准备创建 ${(action.items || []).length || 1} 个待办，确认后由 SalmonApp 本地接口执行。`;
    case "tasks.update":
      return `准备更新待办 ${action.taskId || "(未指定)"}，确认后写回。`;
    case "tasks.delete":
      return `准备删除待办 ${action.taskId || "(未指定)"}。删除不可恢复，请确认。`;
    case "tasks.toggle":
      return `准备将待办 ${action.taskId || "(未指定)"} 标为 ${action.completed ? "已完成" : "未完成"}。`;
    case "calendar.create":
      return `准备创建 ${calendarItems(action).length || 1} 个日历事件，确认后由 SalmonApp 本地接口执行。`;
    case "calendar.update":
      return `准备更新日历事件 ${action.eventId || "(未指定)"}。`;
    case "calendar.delete":
      return `准备删除日历事件 ${action.eventId || "(未指定)"}。删除不可恢复，请确认。`;
    case "mail.draft":
      return "准备保存邮件草稿，确认后由 SalmonApp 本地接口执行。";
    case "mail.send":
      return "准备发送邮件。请仔细核对收件人、主题和正文，确认后才会发送。";
    case "mail.reply":
      return "准备回复邮件。请核对收件人、主题、正文，确认后才会发送。";
    case "mail.forward":
      return `准备转发邮件 ${action.messageId || "(未指定)"} 给 ${(action.to || []).join(", ") || "未填写收件人"}。`;
    case "mail.mark_read":
      return `准备将邮件标为 ${action.read === false ? "未读" : "已读"}。`;
    case "mail.star":
      return `准备 ${action.starred === false ? "取消" : "添加"} 邮件 ${action.messageId || "(未指定)"} 的星标。`;
    case "mail.archive":
      return `准备归档邮件 ${action.messageId || "(未指定)"}。`;
    case "contacts.vip":
      return `准备将联系人 ${action.contactId || "(未指定)"} ${action.vip === false ? "取消 VIP" : "标为 VIP"}。`;
    case "contacts.note":
      return action.note && action.note.trim().length > 0
        ? `准备给联系人 ${action.contactId || "(未指定)"} 写本地备注。`
        : `准备清空联系人 ${action.contactId || "(未指定)"} 的本地备注。`;
    case "workflow":
      return `${action.title ? action.title + " · " : ""}${(action.steps || []).length} 步工作流，按顺序执行；任一步失败立即停下。`;
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
  if (action.kind === "tasks.update") {
    const patch = action.patch || {};
    const changes: string[] = [];
    if (patch.title != null) changes.push(`标题: ${patch.title}`);
    if (patch.notes != null) changes.push(`备注: ${truncate(patch.notes, 80)}`);
    if (patch.dueLocal != null) changes.push(`截止: ${patch.dueLocal}`);
    if (patch.completed != null) changes.push(`状态: ${patch.completed ? "已完成" : "未完成"}`);
    return (
      <div className="salmon-action-row">
        <b>任务 {action.taskId || "(未指定)"}</b>
        {changes.length > 0
          ? <span>{changes.join(" · ")}</span>
          : <small>未提供任何更新字段。</small>}
      </div>
    );
  }
  if (action.kind === "tasks.delete") {
    return (
      <div className="salmon-action-row">
        <b>删除任务 {action.taskId || "(未指定)"}</b>
        <small>删除后不可恢复。</small>
      </div>
    );
  }
  if (action.kind === "tasks.toggle") {
    return (
      <div className="salmon-action-row">
        <b>任务 {action.taskId || "(未指定)"}</b>
        <span>切换为 {action.completed ? "已完成" : "未完成"}</span>
      </div>
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
  if (action.kind === "calendar.update") {
    const patch = action.patch || {};
    const changes: string[] = [];
    if (patch.title != null) changes.push(`标题: ${patch.title}`);
    if (patch.startLocal != null || patch.startMs != null) changes.push(`新开始: ${patch.startLocal ?? formatMs(patch.startMs)}`);
    if (patch.endLocal != null || patch.endMs != null) changes.push(`新结束: ${patch.endLocal ?? formatMs(patch.endMs)}`);
    if (patch.allDay != null) changes.push(`全天: ${patch.allDay ? "是" : "否"}`);
    if (patch.location != null) changes.push(`地点: ${patch.location || "(清空)"}`);
    return (
      <div className="salmon-action-row">
        <b>事件 {action.eventId || "(未指定)"}</b>
        {changes.length > 0 ? <span>{changes.join(" · ")}</span> : <small>未提供任何更新字段。</small>}
      </div>
    );
  }
  if (action.kind === "calendar.delete") {
    return (
      <div className="salmon-action-row">
        <b>删除日历事件 {action.eventId || "(未指定)"}</b>
        <small>删除后不可恢复。</small>
      </div>
    );
  }
  if (action.kind === "mail.mark_read") {
    return (
      <div className="salmon-action-row">
        <b>邮件 {action.messageId || "(未指定)"}</b>
        <span>标记为 {action.read === false ? "未读" : "已读"}</span>
      </div>
    );
  }
  if (action.kind === "mail.star") {
    return (
      <div className="salmon-action-row">
        <b>邮件 {action.messageId || "(未指定)"}</b>
        <span>{action.starred === false ? "取消星标" : "添加星标"}</span>
      </div>
    );
  }
  if (action.kind === "mail.archive") {
    return (
      <div className="salmon-action-row">
        <b>归档邮件 {action.messageId || "(未指定)"}</b>
        <small>Gmail 摘掉 INBOX 标签 / Outlook 移到 Archive 文件夹。</small>
      </div>
    );
  }
  if (action.kind === "mail.forward") {
    return (
      <div className="salmon-action-row">
        <b>转发邮件 {action.messageId || "(未指定)"}</b>
        <span>收件人: {(action.to || []).join(", ") || "未填写"}</span>
        {action.cc && action.cc.length > 0 && <span>抄送: {action.cc.join(", ")}</span>}
        {action.bodyPrefix && <small>{truncate(action.bodyPrefix, 160)}</small>}
      </div>
    );
  }
  if (action.kind === "contacts.vip") {
    return (
      <div className="salmon-action-row">
        <b>联系人 {action.contactId || "(未指定)"}</b>
        <span>{action.vip === false ? "取消 VIP 标记" : "标为 VIP"}</span>
      </div>
    );
  }
  if (action.kind === "contacts.note") {
    const text = action.note?.trim();
    return (
      <div className="salmon-action-row">
        <b>联系人 {action.contactId || "(未指定)"}</b>
        {text ? <small>{truncate(text, 200)}</small> : <small>清空本地备注</small>}
      </div>
    );
  }
  if (action.kind === "workflow") {
    return (
      <>
        {(action.steps || []).map((step, i) => (
          <div className="salmon-action-row" key={i}>
            <b>{i + 1}. {step.kind}</b>
            <small>{summarizeAction(step)}</small>
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
    case "tasks.update": {
      if (!action.taskId) throw new Error("tasks.update 缺少 taskId。");
      const patch = action.patch || {};
      const updated = await api.updateTask({
        id: action.taskId,
        title: patch.title ?? null,
        notes: patch.notes ?? null,
        dueMs: patch.dueMs != null
          ? patch.dueMs
          : (patch.dueLocal != null ? resolveLocalTime(null, patch.dueLocal, true) : null),
        completed: patch.completed ?? null,
      });
      return {
        message: "已更新待办",
        actions: [{ label: "查看待办", primary: true, target: { view: "tasks", taskId: updated.id, accountId: updated.accountId } }],
      };
    }
    case "tasks.delete": {
      if (!action.taskId) throw new Error("tasks.delete 缺少 taskId。");
      await api.deleteTask(action.taskId);
      return { message: "已删除待办" };
    }
    case "tasks.toggle": {
      if (!action.taskId) throw new Error("tasks.toggle 缺少 taskId。");
      const updated = await api.updateTask({
        id: action.taskId,
        completed: action.completed ?? true,
      });
      return {
        message: `已${action.completed === false ? "取消完成" : "标记完成"}`,
        actions: [{ label: "查看待办", primary: true, target: { view: "tasks", taskId: updated.id, accountId: updated.accountId } }],
      };
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
    case "calendar.update": {
      if (!action.eventId) throw new Error("calendar.update 缺少 eventId。");
      const account = action.accountId || accountId;
      if (!account) throw new Error("calendar.update 缺少 accountId（请在选择器里选）。");
      const patch = action.patch || {};
      const allDay = patch.allDay ?? null;
      const startMs = patch.startMs != null
        ? patch.startMs
        : (patch.startLocal != null ? resolveLocalTime(null, patch.startLocal, !!allDay) : null);
      const endMs = patch.endMs != null
        ? patch.endMs
        : (patch.endLocal != null ? resolveLocalTime(null, patch.endLocal, !!allDay) : null);
      const updated = await api.updateCalendarEvent({
        accountId: account,
        eventId: action.eventId,
        title: patch.title ?? null,
        startMs,
        endMs,
        allDay,
        location: patch.location ?? null,
      });
      return {
        message: "已更新日历事件",
        actions: [{
          label: "查看日历",
          primary: true,
          target: { view: "calendar", eventId: updated.id, accountId: account, startMs: updated.startMs },
        }],
      };
    }
    case "calendar.delete": {
      if (!action.eventId) throw new Error("calendar.delete 缺少 eventId。");
      const account = action.accountId || accountId;
      if (!account) throw new Error("calendar.delete 缺少 accountId（请在选择器里选）。");
      await api.deleteCalendarEvent(account, action.eventId);
      return { message: "已删除日历事件" };
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
    case "mail.reply": {
      const mail = action.mail;
      if (!mail) throw new Error("mail.reply 缺少邮件内容。");
      if (!mail.replyToMessageId) throw new Error("mail.reply 缺少 replyToMessageId。");
      await api.sendMail(toComposeInput(mail, accountId));
      return {
        message: "已发送回复",
        actions: [{ label: "查看邮件", primary: true, target: { view: "mail", accountId } }],
      };
    }
    case "mail.forward": {
      if (!action.messageId) throw new Error("mail.forward 缺少 messageId。");
      const to = action.to || [];
      if (to.length === 0) throw new Error("mail.forward 缺少收件人。");
      await api.forwardMail({
        messageId: action.messageId,
        to,
        cc: action.cc ?? null,
        bodyPrefix: action.bodyPrefix ?? null,
      });
      return {
        message: "已转发邮件",
        actions: [{ label: "查看邮件", primary: true, target: { view: "mail", accountId } }],
      };
    }
    case "mail.mark_read": {
      if (!action.messageId) throw new Error("mail.mark_read 缺少 messageId。");
      await api.markMailRead(action.messageId, action.read !== false);
      return { message: action.read === false ? "已标为未读" : "已标为已读" };
    }
    case "mail.star": {
      if (!action.messageId) throw new Error("mail.star 缺少 messageId。");
      await api.setMailStar(action.messageId, action.starred !== false);
      return { message: action.starred === false ? "已取消星标" : "已添加星标" };
    }
    case "mail.archive": {
      if (!action.messageId) throw new Error("mail.archive 缺少 messageId。");
      await api.archiveMail(action.messageId);
      return { message: "已归档邮件" };
    }
    case "contacts.vip": {
      if (!action.contactId) throw new Error("contacts.vip 缺少 contactId。");
      await api.setContactVip(action.contactId, action.vip !== false);
      return { message: action.vip === false ? "已取消 VIP" : "已设为 VIP" };
    }
    case "contacts.note": {
      if (!action.contactId) throw new Error("contacts.note 缺少 contactId。");
      const trimmed = action.note?.trim() ?? null;
      await api.setContactNote(action.contactId, trimmed && trimmed.length > 0 ? trimmed : null);
      return { message: trimmed ? "已写入联系人本地备注" : "已清空联系人本地备注" };
    }
    case "workflow": {
      const steps = action.steps || [];
      if (steps.length === 0) throw new Error("workflow 没有步骤。");
      const collected: ToastAction[] = [];
      for (let i = 0; i < steps.length; i++) {
        try {
          const result = await executeSalmonAction(steps[i], accountId);
          if (result.actions) collected.push(...result.actions);
        } catch (e: any) {
          throw new Error(`第 ${i + 1} 步 (${steps[i].kind}) 失败: ${e?.message || e}`);
        }
      }
      return {
        message: `工作流 ${steps.length} 步全部完成`,
        actions: collected.slice(0, 4),
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

// v1.14.0: persist salmon-action execution state across component remounts.
// Without this, navigating to another conversation and back exposes an
// already-executed send/create/delete button as if it were fresh — the
// user could re-trigger a real-world side effect by accident.
//
// localStorage (not sessionStorage) so the disabled state survives app
// restarts too. Key includes both the topic id and a hash of the action
// payload so identical actions in two conversations stay isolated.
const ACTION_PERSIST_PREFIX = "salmon-action-done:";

interface PersistedAction {
  message: string;
  // We deliberately drop the toast `actions` field on persistence —
  // navigation targets like {view: "mail", accountId} could go stale
  // (account deleted, etc). The card just needs to show "Done" with
  // the message; the original toast already gave the user a chance to
  // open the result when fresh.
  executedAt: number;
}

function loadExecutedAction(key: string): PersistedAction | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(ACTION_PERSIST_PREFIX + key);
    if (!v) return null;
    const parsed = JSON.parse(v);
    if (!parsed || typeof parsed.message !== "string") return null;
    return parsed as PersistedAction;
  } catch {
    return null;
  }
}

function markExecutedAction(key: string, result: SalmonActionExecution): void {
  try {
    if (typeof localStorage === "undefined") return;
    const payload: PersistedAction = {
      message: result.message,
      executedAt: Date.now(),
    };
    localStorage.setItem(ACTION_PERSIST_PREFIX + key, JSON.stringify(payload));
  } catch {
    // Quota exceeded / private mode / etc. Silently drop — the live
    // session state still shows done.
  }
}
