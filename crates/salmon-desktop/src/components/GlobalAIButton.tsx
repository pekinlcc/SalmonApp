import { useEffect, useRef, useState } from "react";

/**
 * v1.17.0 — Global "✨ AI" button. Lives in the bottom-right of every
 * top-level view; ⌘K (Mac) / Ctrl+K (Linux/Windows) toggles it open.
 * Click → popover with a context chip describing what the user is
 * currently looking at + a freeform textarea. Submit → App creates a
 * scratch Topic, drops a context-seed system message in, sends the
 * user's text as the first user message, and navigates into the new
 * Topic.
 *
 * The actual "create topic + seed + send + navigate" plumbing lives in
 * App.tsx — this component just collects input and fires a callback.
 *
 * Context is structured app state (per-view), not screenshot/DOM. See
 * `GlobalAIContext` below and the `useViewContext` setters threaded
 * through each top-level view.
 */

// v1.19.2: the keydown handler accepts both metaKey and ctrlKey, but the
// tooltip / kbd hint used to hardcode "⌘K" — confusing for Linux/Windows
// users who'd see the Mac glyph but actually need Ctrl+K. Switch the
// shown label per platform; the handler behaviour is unchanged.
const IS_MAC =
  typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);
const OPEN_LABEL = IS_MAC ? "⌘K" : "Ctrl+K";
const SUBMIT_HINT = IS_MAC ? "⌘↵ 发送" : "Ctrl+Enter 发送";
export type GlobalAIContext =
  | { kind: "home" }
  | { kind: "mail"; view: "list" | "detail"; accountId?: string | null; messageId?: string | null; threadId?: string | null; subject?: string | null; fromEmail?: string | null; fromName?: string | null }
  | { kind: "calendar"; windowStartMs?: number | null; windowEndMs?: number | null; selectedEventId?: string | null; selectedTitle?: string | null }
  | { kind: "tasks"; filter?: "pending" | "all"; selectedTaskId?: string | null; selectedTitle?: string | null }
  | { kind: "contacts"; selectedEmail?: string | null; selectedName?: string | null }
  | { kind: "briefing"; focusedItemId?: string | null; focusedTitle?: string | null }
  | { kind: "topic"; topicId: string; topicTitle?: string | null };

interface Props {
  context: GlobalAIContext;
  /** Called when user submits. Implementer creates a scratch Topic,
   *  seeds it with the context system message + this user text, then
   *  navigates. Returns the new topic id (or null on failure). */
  onSubmit: (userText: string, context: GlobalAIContext) => Promise<string | null>;
}

export function GlobalAIButton({ context, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ⌘K / Ctrl+K toggles. Escape closes when open.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((cur) => !cur);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  // Focus textarea on open.
  useEffect(() => {
    if (open) {
      window.setTimeout(() => taRef.current?.focus(), 50);
    } else {
      setText("");
    }
  }, [open]);

  const chip = formatContextChip(context);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const newId = await onSubmit(t, context);
      if (newId) {
        setOpen(false);
        setText("");
      }
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <>
      {open && (
        <div className="ai-popover" role="dialog" aria-label="Ask AI">
          <div className="ai-popover-chip" title={chip.title}>
            <span>📎</span>
            <span className="ai-popover-chip-text"><strong>{chip.head}</strong>{chip.tail && <> · {chip.tail}</>}</span>
          </div>
          <textarea
            ref={taRef}
            className="ai-popover-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="问任何事，比如&#10;'把这事变成今天的待办'&#10;'给 Olivia 回个收到'"
            disabled={busy}
          />
          <div className="ai-popover-actions">
            <span className="ai-popover-hint">{SUBMIT_HINT} · 自动新建 Topic</span>
            <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? "新建中..." : "发送 →"}
            </button>
          </div>
          <div className="ai-popover-tail" />
        </div>
      )}
      <button
        className={`ai-fab ${open ? "open" : ""}`}
        onClick={() => setOpen((cur) => !cur)}
        title={`问 AI（${OPEN_LABEL}）— 用当前页面的上下文新建 Topic`}
        aria-label="Ask AI"
      >
        <span className="ai-fab-icon">✨</span>
        <span>AI</span>
        <kbd>{OPEN_LABEL}</kbd>
      </button>
    </>
  );
}

/** Produces the small chip text shown above the textarea so the user
 *  knows exactly what app-state the agent will see. */
function formatContextChip(c: GlobalAIContext): { head: string; tail: string; title: string } {
  switch (c.kind) {
    case "home":
      return { head: "上下文：首页", tail: "", title: "你正在主页，没有特定上下文。" };
    case "mail": {
      if (c.view === "detail" && c.subject) {
        const who = c.fromName || c.fromEmail || "";
        return {
          head: `邮件 · ${truncate(c.subject, 24)}`,
          tail: who ? `from ${truncate(who, 22)}` : "",
          title: `主题: ${c.subject}\n发件人: ${c.fromName ?? ""} <${c.fromEmail ?? ""}>\nid: ${c.messageId ?? "—"}`,
        };
      }
      return { head: "邮件 · 收件箱", tail: "未选中具体邮件", title: "邮件列表视图，无具体邮件选中。" };
    }
    case "calendar": {
      if (c.selectedTitle) {
        return { head: `日历 · ${truncate(c.selectedTitle, 24)}`, tail: "", title: `事件: ${c.selectedTitle}\nid: ${c.selectedEventId ?? "—"}` };
      }
      return { head: "日历", tail: "未选中具体事件", title: "日历视图。" };
    }
    case "tasks": {
      if (c.selectedTitle) {
        return { head: `待办 · ${truncate(c.selectedTitle, 24)}`, tail: "", title: `任务: ${c.selectedTitle}\nid: ${c.selectedTaskId ?? "—"}` };
      }
      return { head: "待办", tail: c.filter === "all" ? "全部" : "未完成", title: "待办列表视图。" };
    }
    case "contacts":
      if (c.selectedEmail) {
        return { head: `联系人 · ${truncate(c.selectedName || c.selectedEmail, 22)}`, tail: "", title: `${c.selectedName ?? ""} <${c.selectedEmail}>` };
      }
      return { head: "联系人", tail: "未选中具体联系人", title: "联系人视图。" };
    case "briefing":
      if (c.focusedTitle) {
        return { head: `推荐 · ${truncate(c.focusedTitle, 24)}`, tail: "", title: c.focusedTitle };
      }
      return { head: "首页 · 推荐", tail: "", title: "推荐列表视图。" };
    case "topic":
      return { head: `Topic · ${truncate(c.topicTitle || "(未命名)", 20)}`, tail: "新建另一个 Topic", title: `当前 Topic id: ${c.topicId}` };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
