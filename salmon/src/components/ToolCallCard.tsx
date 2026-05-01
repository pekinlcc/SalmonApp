import { useState } from "react";
import type { ToolCall } from "../lib/types";

interface Props {
  tool: ToolCall;
  onSelect?: (tool: ToolCall) => void;
}

export function ToolCallCard({ tool, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const summary = summarize(tool);
  return (
    <div className={`tool ${open ? "open" : ""}`}>
      <div
        className="tool-head"
        onClick={() => {
          setOpen(!open);
          onSelect?.(tool);
        }}
      >
        <span className="tool-icon">{abbreviate(tool.name)}</span>
        <span className="tool-name">{tool.name}</span>
        <span className="tool-summary">{summary}</span>
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
