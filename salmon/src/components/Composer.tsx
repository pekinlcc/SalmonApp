import { useState, useRef, useEffect } from "react";

interface Props {
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export function Composer({ busy, disabled, onSend, onInterrupt }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy && !disabled) ref.current?.focus();
  }, [busy, disabled]);

  const submit = () => {
    if (disabled) return;
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
          placeholder={
            disabled
              ? "工作目录不可用,无法发送(选归档或删除该 Topic)"
              : "问点什么…  Enter 发送 · Shift+Enter 换行 · / 开头是斜杠命令（透传给 CLI）"
          }
          value={text}
          disabled={disabled}
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
            disabled={busy || disabled || !text.trim()}
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
