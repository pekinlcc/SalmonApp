import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { MailAccount, Task } from "../lib/types";

/**
 * v0.9.1 — Tasks view (Google Tasks + Microsoft Graph Todo).
 * Standalone left-sidebar entry. Filtered by account; toggle to show
 * completed.
 */
export function TasksView() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountId, setAccountId] = useState<string | "all">("all");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCompleted, setShowCompleted] = useState<boolean>(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const a = await api.listMailAccounts();
      setAccounts(a);
      if (accountId === "all" || a.length === 0) {
        const list = await api.listTasks(null, true);
        setTasks(list);
      } else {
        const list = await api.listTasks(accountId, true);
        setTasks(list);
      }
    } catch (e: any) {
      setError(String(e));
    }
  }, [accountId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const onSync = useCallback(async () => {
    if (accounts.length === 0) return;
    setSyncing(true);
    setError(null);
    try {
      const targets = accountId === "all" ? accounts : accounts.filter((a) => a.id === accountId);
      for (const a of targets) {
        try { await api.syncTasks(a.id); }
        catch (e: any) {
          // Most likely cause: existing OAuth token doesn't have tasks scope.
          // Tell the user explicitly.
          const msg = String(e);
          if (msg.includes("403") || msg.includes("insufficient")) {
            window.dispatchEvent(new CustomEvent("salmon:toast", {
              detail: { title: `${a.email} 需要重新登录以授权 tasks 权限`, kind: "error" },
            }));
          } else {
            api.debugLog(`sync_tasks ${a.email} failed: ${e}`);
          }
        }
      }
      await loadAll();
    } finally {
      setSyncing(false);
    }
  }, [accounts, accountId, loadAll]);

  const onToggle = useCallback(async (t: Task) => {
    const wasCompleted = t.completed;
    // Optimistic update.
    setTasks((cur) => cur.map((x) => x.id === t.id ? { ...x, completed: !wasCompleted } : x));
    try {
      await api.updateTask({ id: t.id, completed: !wasCompleted });
    } catch (e: any) {
      // Revert.
      setTasks((cur) => cur.map((x) => x.id === t.id ? { ...x, completed: wasCompleted } : x));
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: `更新失败: ${e}`, kind: "error" },
      }));
    }
  }, []);

  const onDelete = useCallback(async (t: Task) => {
    if (!confirm(`删除待办 "${t.title}"？也会从云端删除。`)) return;
    try {
      await api.deleteTask(t.id);
      setTasks((cur) => cur.filter((x) => x.id !== t.id));
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: "✓ 已删除", kind: "done" },
      }));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: `删除失败: ${e}`, kind: "error" },
      }));
    }
  }, []);

  const visible = useMemo(
    () => tasks.filter((t) => showCompleted || !t.completed),
    [tasks, showCompleted]
  );
  const pending = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const completed = useMemo(() => tasks.filter((t) => t.completed), [tasks]);

  if (accounts.length === 0) {
    return (
      <div className="empty-feature">
        <div className="empty-icon">📋</div>
        <div className="empty-title">待办</div>
        <div className="empty-sub">
          先到邮件里登录 Gmail / Outlook 账号 — 待办用同一份 OAuth。
          <br />
          如果你之前登录过但没看到待办：账号需要重新登录授权 <code>tasks</code> 权限。
        </div>
      </div>
    );
  }

  return (
    <div className="tasks-shell">
      <div className="tasks-head">
        <div className="tasks-title">📋 待办</div>
        <div className="tasks-stats">
          {pending.length} 未完成 · {completed.length} 已完成
        </div>
        <div className="tasks-actions">
          <select
            className="btn-sm"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value as any)}
          >
            <option value="all">全部账号</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </select>
          <button className="btn-sm" onClick={() => setShowCompleted((v) => !v)}>
            {showCompleted ? "隐藏已完成" : "显示已完成"}
          </button>
          <button className="btn-sm" onClick={onSync} disabled={syncing}>
            {syncing ? "同步中…" : "↻ 同步"}
          </button>
          <button className="btn-sm primary" onClick={() => setComposeOpen(true)}>＋ 新建</button>
        </div>
      </div>
      {error && <div className="tasks-error">⚠ {error}</div>}
      <div className="tasks-list">
        {visible.length === 0 ? (
          <div className="tasks-empty">
            {showCompleted ? "没有任何待办" : "✓ 没有未完成的待办"}
          </div>
        ) : (
          visible.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              account={accounts.find((a) => a.id === t.accountId) || null}
              onToggle={() => onToggle(t)}
              onDelete={() => onDelete(t)}
            />
          ))
        )}
      </div>

      {composeOpen && (
        <NewTaskModal
          accounts={accounts}
          defaultAccountId={
            accountId === "all" ? (accounts[0]?.id ?? "") : accountId
          }
          onClose={() => setComposeOpen(false)}
          onCreated={(t) => {
            setTasks((cur) => [t, ...cur]);
            setComposeOpen(false);
          }}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  account,
  onToggle,
  onDelete,
}: {
  task: Task;
  account: MailAccount | null;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const dueText = useMemo(() => {
    if (!task.dueMs) return null;
    const d = new Date(task.dueMs);
    const now = Date.now();
    const days = Math.floor((task.dueMs - now) / 86400_000);
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    if (!task.completed && task.dueMs < now - 86400_000) {
      const overdue = Math.floor((now - task.dueMs) / 86400_000);
      return { text: `${md} · 逾期 ${overdue}d`, overdue: true };
    }
    if (days === 0) return { text: `${md} · 今日`, overdue: false };
    if (days === 1) return { text: `${md} · 明天`, overdue: false };
    if (days > 0 && days < 7) return { text: `${md} · ${days}d`, overdue: false };
    return { text: md, overdue: false };
  }, [task.dueMs, task.completed]);

  const srcBadge =
    task.sourceKind === "briefing" ? "✦ AI"
    : task.sourceKind === "manual" ? "手动"
    : null;

  return (
    <div className={`task-row ${task.completed ? "done" : ""}`}>
      <div
        className={`task-checkbox ${task.completed ? "checked" : ""}`}
        role="checkbox"
        aria-checked={task.completed}
        onClick={onToggle}
      />
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        {task.notes && <div className="task-notes">{task.notes}</div>}
      </div>
      {dueText && (
        <span className={`task-due ${dueText.overdue ? "overdue" : ""}`}>{dueText.text}</span>
      )}
      {srcBadge && <span className="task-source">{srcBadge}</span>}
      {account && (
        <span className="task-account" title={account.email}>
          {account.provider === "outlook" ? "O" : "G"}
        </span>
      )}
      <button className="task-del" onClick={onDelete} title="删除">×</button>
    </div>
  );
}

function NewTaskModal({
  accounts,
  defaultAccountId,
  onClose,
  onCreated,
}: {
  accounts: MailAccount[];
  defaultAccountId: string;
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState(""); // YYYY-MM-DD
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function onCreate() {
    setError(null);
    if (!title.trim()) { setError("标题不能为空"); return; }
    if (!accountId) { setError("没选账号"); return; }
    setCreating(true);
    try {
      let dueMs: number | null = null;
      if (dueDate) {
        // Interpret local midnight of that date.
        const d = new Date(dueDate + "T00:00:00");
        if (!isNaN(d.getTime())) dueMs = d.getTime();
      }
      const t = await api.createTask({
        accountId,
        title: title.trim(),
        notes: notes.trim() || null,
        dueMs,
        sourceKind: "manual",
        sourceBriefItemId: null,
      });
      onCreated(t);
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: `✓ 已创建待办: ${t.title}`, kind: "done" },
      }));
    } catch (e: any) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="compose-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="compose-modal" style={{ width: 520 }}>
        <div className="compose-head">
          <div className="compose-title">新建待办</div>
          <button className="btn-ghost" onClick={onClose}>×</button>
        </div>
        <div className="compose-from">
          <span className="compose-label">账号:</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email} ({a.provider})</option>
            ))}
          </select>
        </div>
        <div className="compose-field">
          <span className="compose-label">标题:</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="例如：提交报名表"
          />
        </div>
        <div className="compose-field">
          <span className="compose-label">截止:</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <textarea
          className="compose-body"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="备注（可选）"
          style={{ minHeight: 100 }}
        />
        {error && <div className="compose-error">{error}</div>}
        <div className="compose-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={creating}>取消</button>
          <button className="btn primary" onClick={onCreate} disabled={creating}>
            {creating ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
