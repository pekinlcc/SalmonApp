import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";

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

  // WebKit2GTK on Wayland tends to drop image clipboard data from the
  // browser's `paste` event, so we intercept Ctrl/Cmd+V at the keydown
  // layer and pull the image out via the Tauri clipboard plugin instead.
  // Text falls back to readText so manual cursor-insert preserves
  // selection-replace semantics.
  const handlePasteShortcut = async () => {
    setPasting(true);
    let handled = false;
    try {
      const img = await readImage();
      const rgba = await img.rgba();
      const size = await img.size();
      const base64 = await rgbaToPngBase64(rgba, size.width, size.height);
      const path = await invoke<string>("save_pasted_image", {
        topicId,
        base64Data: base64,
        ext: "png",
      });
      const name = path.split("/").pop() || "paste.png";
      const dataUrl = `data:image/png;base64,${base64}`;
      setAttachments((prev) => [...prev, { path, preview: dataUrl, name }]);
      handled = true;
      void invoke("debug_log", { message: `Composer paste: image saved to ${path}` });
    } catch (err) {
      // Not an image (or read failed). Fall back to text paste below.
      void invoke("debug_log", { message: `Composer paste: readImage failed (${err}), trying text` });
    } finally {
      setPasting(false);
    }
    if (handled) return;

    try {
      const txt = await readText();
      if (txt) insertAtCursor(txt);
    } catch (err) {
      void invoke("debug_log", { message: `Composer paste: readText failed (${err})` });
    }
  };

  const insertAtCursor = (insert: string) => {
    const el = ref.current;
    if (!el) {
      setText((t) => t + insert);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
              return;
            }
            const isPaste = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && !e.shiftKey && !e.altKey;
            if (isPaste) {
              e.preventDefault();
              void handlePasteShortcut();
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

async function rgbaToPngBase64(rgba: Uint8Array | number[], width: number, height: number): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const imageData = ctx.createImageData(width, height);
  const buf = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba);
  imageData.data.set(buf);
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1] || "";
}
