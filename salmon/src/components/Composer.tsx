import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";

const IS_MAC =
  typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);
const SEND_SHORTCUT_LABEL = IS_MAC ? "⌘+Enter" : "Ctrl+Enter";

const TEXTAREA_MIN_HEIGHT = 44;
const TEXTAREA_MAX_HEIGHT = 240;

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

interface Draft {
  text: string;
  attachments: Attachment[];
}

export function Composer({ topicId, busy, disabled, onSend, onInterrupt }: Props) {
  // Drafts live per-topic so switching A → B doesn't leak A's text into
  // B's composer. Kept in a ref Map (not React state) because we want to
  // mutate on every keystroke without causing a sibling re-render — only
  // the *active* topic's draft drives rendering, via `text` / `attachments`.
  const draftsRef = useRef<Map<string, Draft>>(new Map());
  const lastTopicRef = useRef<string>(topicId);
  const [text, setText] = useState<string>("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pasting, setPasting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Topic switch: snapshot the outgoing draft, load the incoming one.
  // Doing this during render (vs. useEffect) keeps the new topic from
  // briefly flashing the old topic's text on the first paint.
  if (lastTopicRef.current !== topicId) {
    draftsRef.current.set(lastTopicRef.current, { text, attachments });
    const incoming = draftsRef.current.get(topicId);
    lastTopicRef.current = topicId;
    setText(incoming?.text ?? "");
    setAttachments(incoming?.attachments ?? []);
  }

  useEffect(() => {
    if (!busy && !disabled) ref.current?.focus();
  }, [busy, disabled]);

  // Auto-grow the textarea up to TEXTAREA_MAX_HEIGHT, then scroll. Reset
  // to "auto" first so shrinking back works (scrollHeight only grows).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT);
    el.style.height = `${next}px`;
  }, [text, topicId]);

  const submit = () => {
    if (disabled) return;
    const v = text.trim();
    const refs = attachments.map((a) => `@${a.path}`).join(" ");
    const finalText = refs ? (v ? `${v}\n\n${refs}` : refs) : v;
    if (!finalText) return;
    onSend(finalText);
    setText("");
    setAttachments([]);
    // Clear this topic's stored draft too — submit consumed it.
    draftsRef.current.delete(topicId);
  };

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
              : `问点什么…  ${SEND_SHORTCUT_LABEL} 发送 · Enter 换行 · 直接粘贴图片`
          }
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
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
            title={`快捷键: ${SEND_SHORTCUT_LABEL}`}
          >
            发送 {SEND_SHORTCUT_LABEL}
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
