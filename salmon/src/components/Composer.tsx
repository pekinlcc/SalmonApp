import { useState, useRef, useEffect, type DragEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";
import type { ComposerSendMode } from "../lib/types";

const IS_MAC =
  typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);
const MOD_SEND_SHORTCUT_LABEL = IS_MAC ? "⌘+Enter" : "Ctrl+Enter";

const TEXTAREA_MIN_HEIGHT = 44;
const TEXTAREA_MAX_HEIGHT = 240;

interface Props {
  topicId: string;
  busy: boolean;
  disabled?: boolean;
  sendMode: ComposerSendMode;
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

export function Composer({ topicId, busy, disabled, sendMode, onSend, onInterrupt }: Props) {
  // Drafts live per-topic so switching A → B doesn't leak A's text into
  // B's composer. Kept in a ref Map (not React state) because we want to
  // mutate on every keystroke without causing a sibling re-render — only
  // the *active* topic's draft drives rendering, via `text` / `attachments`.
  const draftsRef = useRef<Map<string, Draft>>(new Map());
  const lastSentRef = useRef<Map<string, string>>(new Map());
  const lastTopicRef = useRef<string>(topicId);
  const [text, setText] = useState<string>("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pasting, setPasting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const sendShortcutLabel = sendMode === "enter" ? "Enter" : MOD_SEND_SHORTCUT_LABEL;
  const newlineShortcutLabel = sendMode === "enter" ? "Shift+Enter" : "Enter";

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
    lastSentRef.current.set(topicId, finalText);
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

  // Dedupes by path so DOM and Tauri drag-drop events (which can both fire
  // for the same Finder drop on Linux) don't double-add the attachment.
  const addAttachmentByPath = (path: string, name?: string, previewOverride?: string) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.path === path)) return prev;
      const realName = name || path.split(/[/\\]/).pop() || "file";
      const ext = realName.split(".").pop()?.toLowerCase() || "";
      const isImg = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext);
      const preview = previewOverride ?? (isImg ? convertFileSrc(path) : "");
      return [...prev, { path, preview, name: realName }];
    });
  };

  // Tauri webview drag-drop listener. On macOS WKWebView the DOM event's
  // `e.dataTransfer.files[i].path` is always empty for Finder drops, so
  // this listener is the only reliable source of filesystem paths there.
  // On Linux/dev mode the DOM event already provides paths; we still
  // subscribe because Tauri delivers a clean Drop event with parsed
  // absolute paths, and `addAttachmentByPath` dedupes by path string.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const wv = getCurrentWebview();
        const fn = await wv.onDragDropEvent((event) => {
          if (cancelled) return;
          const t = event.payload.type;
          if (t === "over") {
            if (!disabled) setDragActive(true);
          } else if (t === "leave") {
            setDragActive(false);
          } else if (t === "drop") {
            setDragActive(false);
            if (disabled) return;
            const paths = (event.payload as { paths?: string[] }).paths || [];
            for (const p of paths) addAttachmentByPath(p);
            ref.current?.focus();
          }
        });
        if (cancelled) fn();
        else unlisten = fn;
      } catch (err) {
        void invoke("debug_log", { message: `Composer: onDragDropEvent setup failed: ${err}` });
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [disabled]);

  const addDroppedFile = async (file: File) => {
    const path = (file as any).path || (file as any).webkitRelativePath || "";
    if (path) {
      addAttachmentByPath(path, file.name);
      return;
    }

    // No DOM-side path. On macOS WKWebView this is the norm for Finder
    // drops — the Tauri webview onDragDropEvent listener above will fill
    // in the absolute path. Bail here so we don't FileReader-cache a
    // copy that the Tauri event would then duplicate.
    if (IS_MAC) {
      void invoke("debug_log", {
        message: `Composer DOM drop on Mac: deferring path lookup to Tauri event (${file.name || "unknown"})`,
      });
      return;
    }

    if (!file.type.startsWith("image/")) {
      void invoke("debug_log", { message: `Composer drop: skipped non-path file ${file.name}` });
      return;
    }

    // In-memory image (e.g. dragged from browser): no filesystem source,
    // no Tauri event will fire — cache it ourselves.
    const dataUrl = await fileToDataUrl(file);
    const base64 = dataUrl.split(",")[1] || "";
    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const savedPath = await invoke<string>("save_pasted_image", {
      topicId,
      base64Data: base64,
      ext,
    });
    addAttachmentByPath(savedPath, file.name || "drop.png", dataUrl);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    setPasting(true);
    try {
      for (const file of files) {
        await addDroppedFile(file);
      }
    } catch (err) {
      void invoke("debug_log", { message: `Composer drop failed: ${err}` });
    } finally {
      setPasting(false);
      ref.current?.focus();
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
      <div
        className={`composer-box ${dragActive ? "drag-active" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <textarea
          ref={ref}
          placeholder={
            disabled
              ? "工作目录不可用,无法发送(选归档或删除该 Topic)"
              : `问点什么...  ${sendShortcutLabel} 发送 · ${newlineShortcutLabel} 换行 · ↑ 恢复上一条 · 可拖拽文件`
          }
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && !text && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              const last = lastSentRef.current.get(topicId);
              if (last) {
                e.preventDefault();
                setText(last);
                requestAnimationFrame(() => {
                  ref.current?.focus();
                  ref.current?.setSelectionRange(last.length, last.length);
                });
              }
              return;
            }
            const modSend = e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
            const enterSend = sendMode === "enter" && e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
            if (modSend || enterSend) {
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
                {a.preview ? <img src={a.preview} alt={a.name} /> : <span className="attach-file-icon">📄</span>}
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
            title={`快捷键: ${sendShortcutLabel}`}
          >
            发送 {sendShortcutLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read file failed"));
    reader.readAsDataURL(file);
  });
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
