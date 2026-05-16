import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { api } from "../lib/api";
import type { Block, ChatLayout, Topic, ToolCall, UiMessage } from "../lib/types";
import { ToolCallCard } from "./ToolCallCard";
import { PermissionCard } from "./PermissionCard";
import { CodeBlock } from "./CodeBlock";
import { SalmonLogo } from "./SalmonLogo";

interface Props {
  topic: Topic;
  messages: UiMessage[];
  pendingPermission: { id: string; tool: string; input: any; command: string | null } | null;
  errorBanner: string | null;
  chatLayout: ChatLayout;
  busy?: boolean;
  /** v1.15.0: extra "engine work coming" signal — true while any salmon-query
   *  card on this topic is executing its API calls and a continueWithLocalContext
   *  call is about to fire. Keeps typing dots visible across the gap between
   *  the previous turn's `exited` and the next turn's `started` events. */
  anticipating?: boolean;
  workdirMissing?: boolean;
  onArchive?: () => void;
  onDelete?: () => void;
  onRetryTopic?: () => void;
  onRefreshClis?: () => void;
  onResetSession?: () => void;
  onApprovePermission: (id: string, allow: boolean) => void;
  onSelectTool: (t: ToolCall) => void;
}

export function ChatStream(props: Props) {
  const { topic, messages, pendingPermission, errorBanner, chatLayout, busy, anticipating, workdirMissing } = props;
  const streamRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const mdComponents = useMemo(() => markdownComponents(topic.workdir, topic.id), [topic.workdir, topic.id]);

  // Typing-indicator visibility: show throughout the assistant turn while
  // the engine is busy. Previously we hid the dots the moment any block
  // arrived (text or tool), which on most prompts collapsed the indicator
  // window to <1s — long enough for the user to never notice it. Now they
  // stay until `exited` flips busy back off, so the user always has a
  // running "still thinking" signal in addition to the per-tool spinners.
  const showTyping = (() => {
    // Anticipating means a salmon-query card is running and a回灌 will
    // hit the engine momentarily. Show dots even if busy briefly dipped.
    if (!busy && !anticipating) return false;
    if (pendingPermission) return false;
    const last = messages[messages.length - 1];
    if (!last) return true;
    if (last.role === "user") return true;
    // While anticipating, the last assistant message may be marked "done"
    // (the previous turn finished) but more output is on the way — keep
    // dots on.
    if (anticipating) return true;
    return last.pending;
  })();

  // ── Auto-scroll: pinned-to-bottom model (ChatGPT / Claude.ai pattern)
  //
  // - `pinnedToBottom` reflects whether the user is sitting near the bottom
  //   of the chat (within BOTTOM_THRESHOLD_PX). It's recomputed on every
  //   scroll event.
  // - `contentSig` is a cheap "how much text is in the chat right now"
  //   signature — it changes on every streamed token, where messages.length
  //   stays constant (the assistant turn is one UiMessage that grows).
  //   Using length-only for the deps was the v0.6.16 bug: streaming text
  //   never re-fired the scroll effect.
  // - When pinned and content grows, snap to bottom with `auto` (instant) so
  //   the view doesn't lag behind tokens. `smooth` skips frames at high
  //   token rates and looks worse than instant.
  // - When the user scrolls up mid-stream, we honour their position and
  //   surface a "↓ 新消息" pill instead. Click jumps with `smooth` for the
  //   visible transition.
  // - Topic switch: snap the new topic to the bottom on first paint and
  //   re-arm pinned, so opening a long topic doesn't dump the user at the
  //   top of yesterday's history.
  const BOTTOM_THRESHOLD_PX = 80;
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  // contentSig is intentionally a single number (sum), not a hash — we only
  // care that it monotonically changes when tokens roll in.
  const contentSig = useMemo(() => {
    let n = 0;
    for (const m of messages) {
      n += m.content?.length || 0;
      if (m.blocks) {
        for (const b of m.blocks) {
          if (b.kind === "text" || b.kind === "thinking") n += b.content.length;
          else n += 1;
        }
      }
    }
    if (pendingPermission) n += 1;
    if (showTyping) n += 1;
    return n;
  }, [messages, pendingPermission, showTyping]);

  // Track contentSig at the moment the user was last pinned, so the pill
  // only appears when there's actually something NEW since they scrolled
  // away (vs. just sitting unpinned in an idle topic).
  const seenSigRef = useRef<number>(contentSig);

  const onScroll = useCallback(() => {
    const el = streamRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = dist < BOTTOM_THRESHOLD_PX;
    setPinnedToBottom((cur) => (cur === near ? cur : near));
  }, []);

  // Auto-follow when pinned. Programmatic scroll fires onScroll → pinned
  // recomputes, but distance is ~0 so it stays true.
  useEffect(() => {
    if (pinnedToBottom) {
      seenSigRef.current = contentSig;
      endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
  }, [contentSig, pinnedToBottom]);

  // Topic switch: reset to pinned and snap to bottom after the new topic's
  // messages are in the DOM.
  useEffect(() => {
    setPinnedToBottom(true);
    const id = requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => cancelAnimationFrame(id);
  }, [topic.id]);

  const jumpToBottom = useCallback(() => {
    setPinnedToBottom(true);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const showJumpPill = !pinnedToBottom && contentSig > seenSigRef.current;

  const time = (ts: number) => new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

  // v0.10.3 — per-topic search. Cmd/Ctrl+F (or the 🔍 button) opens an
  // overlay; results jump to the matching message via scrollIntoView.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ messageId: string; role: string; snippet: string; createdAt: number }[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Hotkey: Cmd/Ctrl+F opens search.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [searchOpen]);

  // Live search as user types (debounce).
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); return; }
    const handle = window.setTimeout(async () => {
      try {
        const rs = await api.searchTopicMessages(topic.id, q, 50);
        setSearchResults(rs.map((r) => ({
          messageId: r.messageId, role: r.role, snippet: r.snippet, createdAt: r.createdAt,
        })));
      } catch {
        setSearchResults([]);
      }
    }, 180);
    return () => window.clearTimeout(handle);
  }, [searchQuery, searchOpen, topic.id]);

  const jumpToMessage = useCallback((messageId: string) => {
    const el = streamRef.current?.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("msg-flash");
    window.setTimeout(() => el.classList.remove("msg-flash"), 1400);
  }, []);

  return (
    <div className="stream-wrap">
      {searchOpen && (
        <div className="topic-search-bar">
          <span className="topic-search-icon">🔍</span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="在这个 Topic 里搜对话…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          <span className="topic-search-count">
            {searchQuery.trim() && `${searchResults.length} 条`}
          </span>
          <button
            className="btn-ghost"
            onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
            title="关闭（Esc）"
          >×</button>
        </div>
      )}
      {searchOpen && searchResults.length > 0 && (
        <div className="topic-search-results">
          {searchResults.map((r) => (
            <div
              key={r.messageId}
              className="topic-search-row"
              onClick={() => jumpToMessage(r.messageId)}
            >
              <span className={`topic-search-role role-${r.role}`}>
                {r.role === "user" ? "你" : r.role === "assistant" ? "S" : "·"}
              </span>
              <span className="topic-search-snippet">{r.snippet}</span>
              <span className="topic-search-ts">{time(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
      {!searchOpen && (
        <button
          className="topic-search-fab"
          onClick={() => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}
          title="搜索此 Topic 内的对话（Ctrl/Cmd+F）"
        >🔍</button>
      )}
      <div className="stream" ref={streamRef} onScroll={onScroll}>
      {messages.length === 0 && !pendingPermission && (
        <div className="banner info" style={{ marginTop: 0 }}>
          这个 Topic 由 <code style={{ fontFamily: "var(--mono)", background: "#fff", padding: "0 4px", borderRadius: 3 }}>{topic.workdir}</code> 工作目录里的 <b>{topic.engine === "claude" ? "claude" : "codex"}</b> CLI 子进程驱动，凭证来自你之前的 CLI 登录。
        </div>
      )}

      {workdirMissing && (
        <div className="workdir-missing">
          <div className="wm-title">⚠ 工作目录已不存在</div>
          <div className="wm-path">
            <code>{topic.workdir}</code>
          </div>
          <div className="wm-desc">
            这个 Topic 绑定的目录已经被删除或移走。CLI(<code>{topic.engine}</code>)无法在缺失的目录里继续跑,新发的消息会立即失败。<br />
            历史对话仍然保留可读;选下面任一操作处理:
          </div>
          <div className="wm-actions">
            <button className="btn" onClick={props.onArchive}>归档(从主列表收起)</button>
            <button className="btn" style={{ color: "#B7493D" }} onClick={props.onDelete}>永久删除</button>
          </div>
        </div>
      )}

      {errorBanner && (
        <ErrorRecoveryBanner
          message={errorBanner}
          engine={topic.engine}
          onRetryTopic={props.onRetryTopic}
          onRefreshClis={props.onRefreshClis}
          onResetSession={props.onResetSession}
        />
      )}

      {messages.map((m) => (
        <div key={m.id} className="msg" data-message-id={m.id}>
          {m.role === "user" ? (
            <div className="avatar user">我</div>
          ) : (
            <SalmonLogo className="avatar ai" />
          )}
          <div className="msg-body">
            <div className="msg-name">
              {m.role === "user"
                ? "你"
                : m.role === "system"
                  ? "SalmonApp · 本地查询结果"
                  : "SalmonApp · " + (topic.engine === "claude" ? "Claude Code" : "Codex")}
              <span className="ts">{time(m.createdAt)}</span>
              {m.interrupted && <span className="interrupted-tag">已中断</span>}
              {m.role === "assistant" && !m.pending && renderTurnStats(m)}
            </div>
            {m.role === "user" ? (
              renderUserBody(m, mdComponents)
            ) : chatLayout === "inline" ? (
              renderInline(m, props.onSelectTool, mdComponents)
            ) : (
              renderThinking(m, props.onSelectTool, mdComponents)
            )}
          </div>
        </div>
      ))}

      {pendingPermission && (
        <div className="msg">
          <SalmonLogo className="avatar ai" />
          <div className="msg-body">
            <div className="msg-name">权限请求 <span className="ts">{time(Date.now())}</span></div>
            <PermissionCard
              tool={pendingPermission.tool}
              command={pendingPermission.command}
              input={pendingPermission.input}
              workdir={topic.workdir}
              onApprove={(a) => props.onApprovePermission(pendingPermission.id, a)}
            />
          </div>
        </div>
      )}

      {showTyping && (
        <div className="msg typing-msg">
          <SalmonLogo className="avatar ai" />
          <div className="msg-body">
            <div className="msg-name">
              SalmonApp · {topic.engine === "claude" ? "Claude Code" : "Codex"}
              <span className="ts">正在思考…</span>
            </div>
            <div className="typing-bubble" aria-label="助手正在响应">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
      </div>
      {showJumpPill && (
        <button
          type="button"
          className="jump-to-bottom"
          onClick={jumpToBottom}
          title="跳到最新消息"
        >
          ↓ 新消息
        </button>
      )}
    </div>
  );
}

function ErrorRecoveryBanner({
  message,
  engine,
  onRetryTopic,
  onRefreshClis,
  onResetSession,
}: {
  message: string;
  engine: string;
  onRetryTopic?: () => void;
  onRefreshClis?: () => void;
  onResetSession?: () => void;
}) {
  const loginCmd = engine === "claude" ? "claude /login" : "codex login";
  const low = message.toLowerCase();
  const looksAuth = low.includes("login") || low.includes("auth") || low.includes("not logged");
  // Claude Code's session jsonl pins a non-msg_ id after a mid-stream socket
  // drop, and every subsequent --resume on that sid fails with the same 400.
  // The only fix is to forget the sid; retrying the topic alone re-spawns
  // with --resume and reproduces the error.
  const looksSessionCorrupt =
    low.includes("previous_message_id") ||
    low.includes("starts with `msg_`") ||
    low.includes("starts with 'msg_'");
  const copyLogin = async () => {
    try {
      await navigator.clipboard.writeText(loginCmd);
    } catch {}
  };
  const confirmReset = () => {
    if (!onResetSession) return;
    const ok = confirm(
      "会话状态损坏(CLI 端的 previous_message_id 已失效)。\n\n" +
      "重置后:\n" +
      "  · Salmon 里的消息全部保留\n" +
      "  · 但 CLI 会忘掉这一轮的上下文,下条消息从空白开始\n\n" +
      "继续重置吗?"
    );
    if (ok) onResetSession();
  };
  return (
    <div className="banner error recover-banner">
      <div className="recover-message">{message}</div>
      <div className="recover-actions">
        {looksSessionCorrupt && onResetSession && (
          <button className="btn" onClick={confirmReset} title="清空 CLI 会话(消息保留)">
            重置会话(开新一轮)
          </button>
        )}
        <button className="btn" onClick={onRetryTopic}>重新启动 Topic</button>
        <button className="btn" onClick={onRefreshClis}>重新检测 CLI</button>
        {looksAuth && (
          <button className="btn" onClick={copyLogin} title="复制登录命令">
            复制 {loginCmd}
          </button>
        )}
      </div>
    </div>
  );
}

/** Right-aligned turn stats next to the assistant message timestamp:
 *  · 用时 4s · 1.2k in · 340 out
 *  Each segment is conditional — older messages without persisted
 *  duration / tokens just get fewer pills. Skip rendering entirely if
 *  there's nothing to show. */
function renderTurnStats(m: UiMessage) {
  const dur = m.durationMs && m.durationMs > 0 ? formatDuration(m.durationMs) : null;
  const tin = m.tokenIn ? formatTokens(m.tokenIn) : null;
  const tout = m.tokenOut ? formatTokens(m.tokenOut) : null;
  if (!dur && !tin && !tout) return null;
  return (
    <span className="turn-stats">
      {dur && <span className="turn-stat" title="用时">· 用时 {dur}</span>}
      {tin && <span className="turn-stat" title="输入 tokens">· {tin} in</span>}
      {tout && <span className="turn-stat" title="输出 tokens">· {tout} out</span>}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function markdownComponents(workdir: string, topicId: string): Components {
  return {
    pre({ children }) {
      return <CodeBlock topicId={topicId}>{children}</CodeBlock>;
    },
    a({ href, children, node: _node, ...props }) {
      const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!href || href.startsWith("#") || event.button !== 0) return;
        event.preventDefault();
        void api.openLink(workdir, href).catch((e) => {
          void api.debugLog(`open_link failed for ${href}: ${e}`);
        });
      };
      return (
        <a {...props} href={href} onClick={onClick}>
          {children}
        </a>
      );
    },
  };
}

function renderUserBody(m: UiMessage, components: Components) {
  return m.content ? (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
      {m.content}
    </ReactMarkdown>
  ) : null;
}

function renderInline(m: UiMessage, onSelectTool: (t: ToolCall) => void, components: Components) {
  const blocks = effectiveBlocks(m);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "text") {
          return (
            <ReactMarkdown
              key={`t${i}`}
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={components}
            >
              {b.content}
            </ReactMarkdown>
          );
        }
        if (b.kind === "thinking") {
          return <ThinkingBlock key={`th${i}`} content={b.content} />;
        }
        return <ToolCallCard key={b.tool.id || `tool${i}`} tool={b.tool} startedAt={b.createdAt} onSelect={onSelectTool} />;
      })}
    </>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  return (
    <div className="thinking-block">
      <span className="thinking-label">推理</span>
      <span className="thinking-content">{content}</span>
    </div>
  );
}

/**
 * Layout B: separate the assistant turn into a "thinking" group (everything
 * up to and including the last tool call) and the "final answer" (trailing
 * text blocks). When there are no tool calls, the whole thing is the answer.
 */
function renderThinking(m: UiMessage, onSelectTool: (t: ToolCall) => void, components: Components) {
  const blocks = effectiveBlocks(m);
  const split = splitThinkingAndAnswer(blocks);
  const toolCount = split.thinking.filter((b) => b.kind === "tool").length;

  return (
    <>
      {split.thinking.length > 0 && (
        <details className="think-group" open={toolCount === 0 || m.pending}>
          <summary className="think-head">
            <span className="caret">▸</span>
            <span>思考过程</span>
            {toolCount > 0 && <span className="think-count">{toolCount} 步</span>}
            {m.pending && <span className="think-time">进行中…</span>}
          </summary>
          <div className="think-body">
            {split.thinking.map((b, i) => {
              if (b.kind === "text") {
                return (
                  <ReactMarkdown
                    key={`tt${i}`}
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={components}
                  >
                    {b.content}
                  </ReactMarkdown>
                );
              }
              if (b.kind === "thinking") {
                return <ThinkingBlock key={`th${i}`} content={b.content} />;
              }
              return (
                <ToolCallCard
                  key={b.tool.id || `tool${i}`}
                  tool={b.tool}
                  startedAt={b.createdAt}
                  onSelect={onSelectTool}
                />
              );
            })}
          </div>
        </details>
      )}
      {split.answer.length > 0 && (
        <div className="final-answer">
          {split.answer.map((b, i) => (
            <ReactMarkdown
              key={`fa${i}`}
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={components}
            >
              {b.content}
            </ReactMarkdown>
          ))}
        </div>
      )}
    </>
  );
}

function splitThinkingAndAnswer(blocks: Block[]): {
  thinking: Block[];
  answer: Array<Extract<Block, { kind: "text" }>>;
} {
  // Pure-text turn (no tools, no extended-thinking blocks): everything is
  // the answer.
  const hasNonText = blocks.some((b) => b.kind !== "text");
  if (!hasNonText) {
    return {
      thinking: [],
      answer: blocks.filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text"),
    };
  }

  // Find the last "thinking-side" block — tool or thinking. Anything *text*
  // after it is the trailing answer.
  let lastNonTextIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const k = blocks[i].kind;
    if (k === "tool" || k === "thinking") {
      lastNonTextIdx = i;
      break;
    }
  }
  const after = blocks
    .slice(lastNonTextIdx + 1)
    .filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text");
  if (after.length > 0) {
    return { thinking: blocks.slice(0, lastNonTextIdx + 1), answer: after };
  }

  // No text after the last thinking-side block. Fall back to the last text
  // block anywhere in the turn as the answer; the rest goes into thinking.
  // Slight ordering quirk if there are tools *after* that text block, but
  // burying the substantive answer is worse than the visual reorder.
  let lastTextIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].kind === "text") {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx === -1) {
    return { thinking: blocks, answer: [] };
  }
  const thinking = blocks.filter((_, idx) => idx !== lastTextIdx);
  const answer = [blocks[lastTextIdx] as Extract<Block, { kind: "text" }>];
  return { thinking, answer };
}

/**
 * Returns the assistant message's blocks. If `blocks` is empty (e.g. an
 * old DB-loaded message), synthesize a single text block from `content`
 * so legacy renders still show something.
 */
function effectiveBlocks(m: UiMessage): Block[] {
  if (m.blocks && m.blocks.length > 0) return m.blocks;
  if (m.content) return [{ kind: "text", content: m.content, createdAt: m.createdAt }];
  return [];
}
