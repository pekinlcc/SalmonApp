import { useEffect, useRef } from "react";
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
  const endRef = useRef<HTMLDivElement>(null);

  // Typing-indicator visibility: show when the engine is busy and the
  // currently-pending assistant turn has not produced any block yet — i.e.,
  // the gap between sending and the first stream event arriving.
  const showTyping = (() => {
    if (!busy) return false;
    if (pendingPermission) return false;
    const last = messages[messages.length - 1];
    if (!last) return true;                                  // user just sent, nothing back yet
    if (last.role === "user") return true;                   // last entry is user → assistant bubble pending
    // Last entry is an assistant message; only hide if it has actual content/blocks already.
    const blocks = last.blocks?.length || 0;
    const hasContent = blocks > 0 || (last.content && last.content.length > 0);
    return last.pending && !hasContent;
  })();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingPermission, showTyping]);

  const time = (ts: number) => new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="stream">
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
      {blocks.map((b, i) =>
        b.kind === "text" ? (
          <ReactMarkdown
            key={`t${i}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={MD_COMPONENTS}
          >
            {b.content}
          </ReactMarkdown>
        ) : (
          <ToolCallCard key={b.tool.id || `tool${i}`} tool={b.tool} onSelect={onSelectTool} />
        )
      )}
    </>
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
            {split.thinking.map((b, i) =>
              b.kind === "text" ? (
                <ReactMarkdown
                  key={`tt${i}`}
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={MD_COMPONENTS}
                >
                  {b.content}
                </ReactMarkdown>
              ) : (
                <ToolCallCard
                  key={b.tool.id || `tool${i}`}
                  tool={b.tool}
                  onSelect={onSelectTool}
                />
              )
            )}
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
  let lastToolIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].kind === "tool") {
      lastToolIdx = i;
      break;
    }
  }
  if (lastToolIdx === -1) {
    return {
      thinking: [],
      answer: blocks.filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text"),
    };
  }
  return {
    thinking: blocks.slice(0, lastToolIdx + 1),
    answer: blocks
      .slice(lastToolIdx + 1)
      .filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text"),
  };
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
