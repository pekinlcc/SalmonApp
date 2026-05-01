import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Topic, ToolCall, UiMessage } from "../lib/types";
import { ToolCallCard } from "./ToolCallCard";
import { PermissionCard } from "./PermissionCard";

interface Props {
  topic: Topic;
  messages: UiMessage[];
  pendingPermission: { id: string; tool: string; input: any; command: string | null } | null;
  errorBanner: string | null;
  onApprovePermission: (id: string, allow: boolean) => void;
  onSelectTool: (t: ToolCall) => void;
}

export function ChatStream(props: Props) {
  const { topic, messages, pendingPermission, errorBanner } = props;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingPermission]);

  const time = (ts: number) => new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="stream">
      {messages.length === 0 && !pendingPermission && (
        <div className="banner info" style={{ marginTop: 0 }}>
          这个 Topic 由 <code style={{ fontFamily: "var(--mono)", background: "#fff", padding: "0 4px", borderRadius: 3 }}>{topic.workdir}</code> 工作目录里的 <b>{topic.engine === "claude" ? "claude" : "codex"}</b> CLI 子进程驱动，凭证来自你之前的 CLI 登录。
        </div>
      )}

      {errorBanner && (
        <div className="banner error">{errorBanner}</div>
      )}

      {messages.map((m) => (
        <div key={m.id} className="msg">
          <div className={`avatar ${m.role === "user" ? "user" : "ai"}`}>
            {m.role === "user" ? "我" : "S"}
          </div>
          <div className="msg-body">
            <div className="msg-name">
              {m.role === "user" ? "你" : "Salmon · " + (topic.engine === "claude" ? "Claude Code" : "Codex")}
              <span className="ts">{time(m.createdAt)}</span>
              {m.interrupted && <span className="interrupted-tag">已中断</span>}
            </div>
            {m.content && (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {m.content}
              </ReactMarkdown>
            )}
            {m.tools.map((t) => (
              <ToolCallCard key={t.id} tool={t} onSelect={props.onSelectTool} />
            ))}
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

      <div ref={endRef} />
    </div>
  );
}
