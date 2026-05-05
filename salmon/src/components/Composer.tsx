import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  topicId: string;
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

interface Attachment {
  path: string;
  preview: string;
  name: string;
}

export function Composer({ topicId, busy, disabled, onSend, onInterrupt }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pasting, setPasting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!busy && !disabled) ref.current?.focus();
  }, [busy, disabled]);

  // Reset attachments when switching Topics so a paste from one Topic
  // doesn't leak into another.
  useEffect(() => {
    setAttachments([]);
  }, [topicId]);

  const submit = () => {
    if (disabled) return;
    const v = text.trim();
    const refs = attachments.map((a) => `@${a.path}`).join(" ");
    const finalText = refs ? (v ? `${v}\n\n${refs}` : refs) : v;
    if (!finalText) return;
    onSend(finalText);
    setText("");
    setAttachments([]);
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(
      (it) => it.kind === "file" && it.type.startsWith("image/")
    );
    if (imageItems.length === 0) return; // text paste — let the textarea handle it
    e.preventDefault();
    setPasting(true);
    try {
      for (const it of imageItems) {
        const blob = it.getAsFile();
        if (!blob) continue;
        const ext = (it.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const base64 = await blobToBase64(blob);
        const dataUrl = `data:${it.type};base64,${base64}`;
        const path = await invoke<string>("save_pasted_image", {
          topicId,
          base64Data: base64,
          ext,
        });
        const name = path.split("/").pop() || `paste.${ext}`;
        setAttachments((prev) => [...prev, { path, preview: dataUrl, name }]);
      }
    } catch (err) {
      console.error("save_pasted_image failed:", err);
      alert(`图片粘贴失败: ${err}`);
    } finally {
      setPasting(false);
    }
  };

  const removeAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
  };

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={ref}
          placeholder={
            disabled
              ? "工作目录不可用,无法发送(选归档或删除该 Topic)"
              : "问点什么…  Enter 发送 · Shift+Enter 换行 · 直接粘贴图片"
          }
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {(attachments.length > 0 || pasting) && (
          <div className="composer-attachments">
            {attachments.map((a) => (
              <div key={a.path} className="attach-chip" title={a.path}>
                <img src={a.preview} alt={a.name} />
                <span className="attach-name">{a.name}</span>
                <button
                  type="button"
                  className="attach-remove"
                  onClick={() => removeAttachment(a.path)}
                  title="移除"
                >
                  ×
                </button>
              </div>
            ))}
            {pasting && <div className="attach-chip attach-loading">粘贴中…</div>}
          </div>
        )}
        <div className="composer-toolbar">
          {busy && <span style={{ color: "var(--salmon-700)" }}>● 处理中</span>}
          {busy && (
            <button className="stop-btn" onClick={onInterrupt} title="发送 SIGINT 给后台 CLI">
              ■ 中断
            </button>
          )}
          <button
            className="send-btn"
            disabled={busy || disabled || (!text.trim() && attachments.length === 0)}
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // data:<mime>;base64,<payload>
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
