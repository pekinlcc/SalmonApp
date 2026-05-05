import { useEffect, useRef } from "react";
import type { NotifyKind, ToastEvent } from "../lib/notify";

interface Props {
  toasts: ToastEvent[];
  onDismiss: (id: string) => void;
  onClick: (t: ToastEvent) => void;
}

const TIMEOUT_BY_KIND: Record<NotifyKind, number> = {
  permission: 10_000, // sticky-ish: user actually needs to act
  done: 4_000,
  error: 8_000,
  crash: 8_000,
  recs: 5_000,
};

const ICON_BY_KIND: Record<NotifyKind, string> = {
  permission: "🔐",
  done: "✓",
  error: "⚠",
  crash: "✕",
  recs: "✦",
};

export function Toasts({ toasts, onDismiss, onClick }: Props) {
  // Per-toast timer registry. Without this, re-rendering on every toast
  // arrival would clear and restart timers for ALL toasts, so older toasts
  // never auto-dismiss while new ones keep coming in.
  const timersRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    for (const [id, handle] of timersRef.current) {
      if (!live.has(id)) {
        window.clearTimeout(handle);
        timersRef.current.delete(id);
      }
    }
    for (const t of toasts) {
      if (timersRef.current.has(t.id)) continue;
      const handle = window.setTimeout(
        () => onDismiss(t.id),
        TIMEOUT_BY_KIND[t.kind] ?? 5000,
      );
      timersRef.current.set(t.id, handle);
    }
  }, [toasts, onDismiss]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers.values()) window.clearTimeout(handle);
      timers.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts">
      {toasts.map((t) => {
        const clickable = !!t.topicId;
        return (
          <div
            key={t.id}
            className={`toast toast-${t.kind}${clickable ? " toast-clickable" : ""}`}
            onClick={() => {
              if (clickable) onClick(t);
              onDismiss(t.id);
            }}
            role={clickable ? "button" : undefined}
            title={clickable ? "点击跳转到对应 Topic" : undefined}
          >
            <span className="toast-icon">{ICON_BY_KIND[t.kind]}</span>
            <div className="toast-text">
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
            </div>
            <button
              type="button"
              className="toast-close"
              aria-label="关闭"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(t.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
