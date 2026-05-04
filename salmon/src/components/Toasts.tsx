import { useEffect } from "react";
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
  useEffect(() => {
    const timers = toasts.map((t) =>
      window.setTimeout(() => onDismiss(t.id), TIMEOUT_BY_KIND[t.kind] ?? 5000)
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [toasts, onDismiss]);

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
