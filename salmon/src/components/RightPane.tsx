import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { FileEntry, ToolCall, Topic } from "../lib/types";

interface Props {
  topic: Topic;
  selectedTool: ToolCall | null;
  logs: string[];
  refreshKey: number;
}

type Tab = "files" | "diff" | "preview" | "logs";

export function RightPane({ topic, selectedTool, logs, refreshKey }: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string>("");

  useEffect(() => {
    if (!topic) return;
    api.listWorkdirFiles(topic.workdir).then(setFiles).catch(() => setFiles([]));
  }, [topic.workdir, refreshKey]);

  useEffect(() => {
    if (!previewPath) return;
    api.readFileText(previewPath).then(setPreviewText).catch((e) => setPreviewText(`(无法预览：${e})`));
  }, [previewPath]);

  // Auto switch to diff tab when an Edit/Write tool is selected
  useEffect(() => {
    if (selectedTool && (selectedTool.name === "Edit" || selectedTool.name === "Write")) {
      setTab("diff");
    }
  }, [selectedTool?.id]);

  return (
    <aside className="right">
      <div className="tabs">
        {(["files", "diff", "preview", "logs"] as Tab[]).map((t) => (
          <div
            key={t}
            className={`tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {labelOf(t)}
          </div>
        ))}
      </div>

      {tab === "files" && (
        <>
          <div className="right-toolbar">
            <span style={{ fontFamily: "var(--mono)", background: "var(--ink-50)", padding: "2px 7px", borderRadius: 4, color: "var(--ink-700)" }}>
              {topic.workdir}
            </span>
            <span style={{ marginLeft: "auto" }}>{files.length} 项</span>
          </div>
          <div className="right-body">
            <div className="tree">
              {files.map((f) => (
                <div
                  key={f.path}
                  className={`row ${previewPath === f.path ? "sel" : ""}`}
                  onClick={() => {
                    if (!f.isDir) {
                      setPreviewPath(f.path);
                      setTab("preview");
                    }
                  }}
                >
                  <span>{f.isDir ? "📁" : "📄"}</span>
                  <span>{f.name}</span>
                  {!f.isDir && (
                    <span style={{ marginLeft: "auto", color: "var(--ink-500)", fontSize: 11 }}>
                      {fmtSize(f.size)}
                    </span>
                  )}
                </div>
              ))}
              {files.length === 0 && <div className="empty">空目录</div>}
            </div>
          </div>
        </>
      )}

      {tab === "diff" && (
        <DiffTab tool={selectedTool} />
      )}

      {tab === "preview" && (
        <>
          <div className="right-toolbar">
            <span style={{ fontFamily: "var(--mono)" }}>{previewPath || "未选中文件"}</span>
          </div>
          <div className="right-body">
            <div className="preview-text">{previewText || "（点左侧文件预览）"}</div>
          </div>
        </>
      )}

      {tab === "logs" && (
        <>
          <div className="right-toolbar"><span>当前 Topic 的 CLI 原始流</span></div>
          <div className="right-body logs">
            {logs.slice(-500).map((l, i) => <div key={i} className="l">{l}</div>)}
            {logs.length === 0 && <div className="empty">还没有日志</div>}
          </div>
        </>
      )}
    </aside>
  );
}

function labelOf(t: Tab) {
  return ({ files: "Files", diff: "Diff", preview: "Preview", logs: "Logs" } as Record<Tab, string>)[t];
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

function DiffTab({ tool }: { tool: ToolCall | null }) {
  if (!tool || (tool.name !== "Edit" && tool.name !== "Write")) {
    return (
      <>
        <div className="right-toolbar"><span>选中一次 Edit/Write 工具调用查看 diff</span></div>
        <div className="empty">还没有 diff 可看</div>
      </>
    );
  }
  const i = tool.input || {};
  if (tool.name === "Write") {
    const content = (i.content as string) || "";
    return (
      <>
        <div className="right-toolbar">
          <span style={{ fontFamily: "var(--mono)", background: "var(--ink-50)", padding: "2px 7px", borderRadius: 4 }}>{i.file_path || "?"}</span>
          <span style={{ marginLeft: "auto" }}>+{content.split("\n").length} 行（新文件）</span>
        </div>
        <div className="right-body">
          <div className="diff">
            <div className="hunk">@@ new file @@</div>
            {content.split("\n").map((line, idx) => (
              <div key={idx} className="line add">+{line}</div>
            ))}
          </div>
        </div>
      </>
    );
  }
  // Edit
  const oldStr = (i.old_string as string) || "";
  const newStr = (i.new_string as string) || "";
  return (
    <>
      <div className="right-toolbar">
        <span style={{ fontFamily: "var(--mono)", background: "var(--ink-50)", padding: "2px 7px", borderRadius: 4 }}>{i.file_path || "?"}</span>
      </div>
      <div className="right-body">
        <div className="diff">
          <div className="hunk">@@ replacement @@</div>
          {oldStr.split("\n").map((line, idx) => (
            <div key={"o" + idx} className="line del">-{line}</div>
          ))}
          {newStr.split("\n").map((line, idx) => (
            <div key={"n" + idx} className="line add">+{line}</div>
          ))}
        </div>
      </div>
    </>
  );
}
