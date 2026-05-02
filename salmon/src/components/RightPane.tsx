import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
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
  const [officeImages, setOfficeImages] = useState<string[] | null>(null);
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);

  useEffect(() => {
    if (!previewFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewFullscreen]);

  // Reset preview state whenever the topic changes — file list is per-workdir,
  // and a path from the previous topic is no longer meaningful.
  useEffect(() => {
    setPreviewPath(null);
    setPreviewText("");
    setOfficeImages(null);
    setOfficeError(null);
    setOfficeLoading(false);
    setTab("files");
    setPreviewFullscreen(false);
  }, [topic.id]);

  useEffect(() => {
    if (!topic) return;
    api.listWorkdirFiles(topic.workdir).then(setFiles).catch(() => setFiles([]));
  }, [topic.workdir, refreshKey]);

  useEffect(() => {
    if (!previewPath) return;
    let cancelled = false;
    setOfficeImages(null);
    setOfficeError(null);
    if (isOfficeFile(previewPath)) {
      setPreviewText("");
      setOfficeLoading(true);
      api.renderOfficePreview(previewPath)
        .then((imgs) => {
          if (cancelled) return;
          setOfficeImages(imgs);
          setOfficeLoading(false);
        })
        .catch((e) => {
          if (cancelled) return;
          setOfficeError(String(e));
          setOfficeLoading(false);
        });
    } else {
      setOfficeLoading(false);
      api.readFileText(previewPath)
        .then((t) => { if (!cancelled) setPreviewText(t); })
        .catch((e) => { if (!cancelled) setPreviewText(`(无法预览：${e})`); });
    }
    return () => {
      cancelled = true;
    };
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
            <span style={{ fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{previewPath || "未选中文件"}</span>
            {officeImages && (
              <span>{officeImages.length} 页</span>
            )}
            {previewPath && (
              <button
                className="icon-btn"
                title="全屏预览 (Esc 退出)"
                onClick={() => setPreviewFullscreen(true)}
              >
                ⛶
              </button>
            )}
          </div>
          <div className="right-body">
            {renderPreviewBody({ previewPath, previewText, officeImages, officeLoading, officeError })}
          </div>
        </>
      )}

      {previewFullscreen && previewPath && (
        <div className="preview-overlay" role="dialog" aria-modal="true">
          <div className="preview-overlay-head">
            <span className="preview-overlay-path">{previewPath}</span>
            {officeImages && <span className="preview-overlay-meta">{officeImages.length} 页</span>}
            <button
              className="icon-btn"
              title="退出全屏 (Esc)"
              onClick={() => setPreviewFullscreen(false)}
            >
              ✕
            </button>
          </div>
          <div className="preview-overlay-body">
            {renderPreviewBody({ previewPath, previewText, officeImages, officeLoading, officeError, fullscreen: true })}
          </div>
        </div>
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

interface PreviewBodyArgs {
  previewPath: string | null;
  previewText: string;
  officeImages: string[] | null;
  officeLoading: boolean;
  officeError: string | null;
  fullscreen?: boolean;
}

function renderPreviewBody(a: PreviewBodyArgs) {
  const p = a.previewPath;
  if (!p) return <div className="preview-text">（点左侧文件预览）</div>;
  if (isOfficeFile(p)) {
    if (a.officeLoading) return <div className="empty">渲染中…(LibreOffice 首次启动约 3 秒)</div>;
    if (a.officeError) return <div className="preview-text">(渲染失败：{a.officeError})</div>;
    if (a.officeImages) {
      return (
        <div className={`office-preview${a.fullscreen ? " full" : ""}`}>
          {a.officeImages.map((src, i) => (
            <div key={i} className="slide-item">
              <div className="slide-num">第 {i + 1} 页</div>
              <img src={src} alt={`slide ${i + 1}`} />
            </div>
          ))}
        </div>
      );
    }
    return null;
  }
  if (isHtmlFile(p)) {
    return a.previewText ? (
      <iframe
        className="preview-html"
        sandbox="allow-same-origin"
        srcDoc={a.previewText}
        title={p}
      />
    ) : (
      <div className="empty">读取中…</div>
    );
  }
  if (isMarkdownFile(p)) {
    return (
      <div className={`preview-md${a.fullscreen ? " full" : ""}`}>
        {a.previewText ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {a.previewText}
          </ReactMarkdown>
        ) : (
          <div className="empty">读取中…</div>
        )}
      </div>
    );
  }
  return <div className="preview-text">{a.previewText || "（点左侧文件预览）"}</div>;
}

function isOfficeFile(path: string): boolean {
  const ext = path.toLowerCase().split(".").pop() || "";
  return ["pptx", "ppt", "docx", "doc", "xlsx", "xls", "odp", "odt", "ods"].includes(ext);
}

function isMarkdownFile(path: string): boolean {
  const ext = path.toLowerCase().split(".").pop() || "";
  return ["md", "markdown", "mdx", "mdown"].includes(ext);
}

function isHtmlFile(path: string): boolean {
  const ext = path.toLowerCase().split(".").pop() || "";
  return ["html", "htm", "xhtml", "svg"].includes(ext);
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
