import { useEffect, useState } from "react";
import type { ToolCall } from "../lib/types";

interface Props {
  tool: ToolCall;
  /** Block.createdAt — used to render an elapsed-time counter while the
   *  tool is still running, so the card doesn't look frozen on long ops. */
  startedAt?: number;
  onSelect?: (tool: ToolCall) => void;
}

export function ToolCallCard({ tool, startedAt, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const summary = summarize(tool);
  const running = tool.state === "running";
  const elapsed = useElapsedSeconds(running ? startedAt : undefined);
  return (
    <div className={`tool ${open ? "open" : ""} ${running ? "tool-running" : ""}`}>
      <div
        className="tool-head"
        onClick={() => {
          setOpen(!open);
          onSelect?.(tool);
        }}
      >
        <span className={`tool-icon ${running ? "tool-icon-running" : ""}`}>
          {running ? <span className="tool-spinner" /> : abbreviate(tool.name)}
        </span>
        <span className="tool-name">{tool.name}</span>
        <span className="tool-summary">{summary}</span>
        {running && elapsed >= 2 && (
          <span className="tool-elapsed" title="已运行时间">{formatElapsed(elapsed)}</span>
        )}
        <span className={`tool-state ${tool.state}`}>{tool.state}</span>
      </div>
      {open && (
        <div className="tool-body">
          <div style={{ marginBottom: 8 }}>
            <b style={{ color: "var(--ink-500)" }}>input</b>
            <pre style={{ margin: "4px 0", fontFamily: "inherit", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>
          {tool.result && (
            <div>
              <b style={{ color: "var(--ink-500)" }}>result</b>
              <pre style={{ margin: "4px 0", fontFamily: "inherit", whiteSpace: "pre-wrap" }}>
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function useElapsedSeconds(startedAt: number | undefined): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

function abbreviate(name: string): string {
  if (!name) return "?";
  if (name === "Read") return "R";
  if (name === "Edit") return "E";
  if (name === "Write") return "W";
  if (name === "Bash") return "B";
  if (name === "Grep") return "G";
  if (name === "Glob") return "✱";
  return name[0].toUpperCase();
}

function summarize(tool: ToolCall): string {
  const i = tool.input || {};
  switch (tool.name) {
    case "Read":
      return i.file_path || "";
    case "Edit":
    case "Write":
      return i.file_path || "";
    case "Bash":
      return (i.command || "").split("\n")[0].slice(0, 120);
    case "Grep":
      return `${i.pattern || ""}${i.path ? " · " + i.path : ""}`;
    case "Glob":
      return i.pattern || "";
    default:
      try {
        const k = Object.keys(i)[0];
        if (k) return `${k}=${JSON.stringify(i[k]).slice(0, 80)}`;
      } catch {}
      return "";
  }
}
