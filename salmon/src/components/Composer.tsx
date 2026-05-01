import { useState, useRef, useEffect } from "react";

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export function Composer({ busy, onSend, onInterrupt }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy) ref.current?.focus();
  }, [busy]);

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText("");
  };

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={ref}
          placeholder="问点什么…  Enter 发送 · Shift+Enter 换行 · / 开头是斜杠命令（透传给 CLI）"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-toolbar">
          {busy && <span style={{ color: "var(--salmon-700)" }}>● 处理中</span>}
          {busy && (
            <button className="stop-btn" onClick={onInterrupt} title="发送 SIGINT 给后台 CLI">
              ■ 中断
            </button>
          )}
          <button
            className="send-btn"
            disabled={busy || !text.trim()}
            onClick={submit}
            style={{ marginLeft: "auto" }}
          >
            发送 ⏎
          </button>
        </div>
      </div>
    </div>
  );
}
