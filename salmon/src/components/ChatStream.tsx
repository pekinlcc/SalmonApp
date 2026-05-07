import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Block, ChatLayout, Topic, ToolCall, UiMessage } from "../lib/types";
import { ToolCallCard } from "./ToolCallCard";
import { PermissionCard } from "./PermissionCard";
import { CodeBlock } from "./CodeBlock";

const MD_COMPONENTS = { pre: CodeBlock } as const;

interface Props {
  topic: Topic;
  messages: UiMessage[];
  pendingPermission: { id: string; tool: string; input: any; command: string | null } | null;
  errorBanner: string | null;
  chatLayout: ChatLayout;
  busy?: boolean;
  workdirMissing?: boolean;
  onArchive?: () => void;
  onDelete?: () => void;
  onApprovePermission: (id: string, allow: boolean) => void;
  onSelectTool: (t: ToolCall) => void;
}

export function ChatStream(props: Props) {
  const { topic, messages, pendingPermission, errorBanner, chatLayout, busy, workdirMissing } = props;
  const streamRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Typing-indicator visibility: show throughout the assistant turn while
  // the engine is busy. Previously we hid the dots the moment any block
  // arrived (text or tool), which on most prompts collapsed the indicator
  // window to <1s — long enough for the user to never notice it. Now they
  // stay until `exited` flips busy back off, so the user always has a
  // running "still thinking" signal in addition to the per-tool spinners.
  const showTyping = (() => {
    if (!busy) return false;
    if (pendingPermission) return false;
    const last = messages[messages.length - 1];
    if (!last) return true;
    if (last.role === "user") return true;
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

  return (
    <div className="stream-wrap">
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

      {errorBanner && <div className="banner error">{errorBanner}</div>}

      {messages.map((m) => (
        <div key={m.id} className="msg">
          <div className={`avatar ${m.role === "user" ? "user" : "ai"}`}>
            {m.role === "user" ? "我" : "S"}
          </div>
          <div className="msg-body">
            <div className="msg-name">
              {m.role === "user" ? "你" : "SalmonApp · " + (topic.engine === "claude" ? "Claude Code" : "Codex")}
              <span className="ts">{time(m.createdAt)}</span>
              {m.interrupted && <span className="interrupted-tag">已中断</span>}
            </div>
            {m.role === "user" ? (
              renderUserBody(m)
            ) : chatLayout === "inline" ? (
              renderInline(m, props.onSelectTool)
            ) : (
              renderThinking(m, props.onSelectTool)
            )}
          </div>
        </div>
      ))}

      {pendingPermission && (
        <div className="msg">
          <div className="avatar ai">S</div>
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
          <div className="avatar ai">S</div>
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

function renderUserBody(m: UiMessage) {
  return m.content ? (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={MD_COMPONENTS}>
      {m.content}
    </ReactMarkdown>
  ) : null;
}

function renderInline(m: UiMessage, onSelectTool: (t: ToolCall) => void) {
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
              components={MD_COMPONENTS}
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
function renderThinking(m: UiMessage, onSelectTool: (t: ToolCall) => void) {
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
                    components={MD_COMPONENTS}
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
              components={MD_COMPONENTS}
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
