import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

export function PromptDialog({
  title,
  initialValue = "",
  placeholder,
  confirmLabel = "确定",
  cancelLabel = "取消",
  onCancel,
  onConfirm,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <label>
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>{cancelLabel}</button>
          <button className="btn primary" onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
