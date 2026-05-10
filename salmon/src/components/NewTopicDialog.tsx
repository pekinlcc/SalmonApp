import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { CliInfo, Topic } from "../lib/types";

interface Props {
  cliStatus: CliInfo[];
  defaultEngine: string;
  topics: Topic[];
  onCancel: () => void;
  onCreate: (args: {
    title: string;
    engine: string;
    workdir: string;
    model: string | null;
    dangerMode: boolean;
  }) => void;
}

export function NewTopicDialog({ cliStatus, defaultEngine, topics, onCancel, onCreate }: Props) {
  const available = cliStatus.filter((c) => c.installed && c.loggedIn);
  const fallbackEngine = available[0]?.binary || "claude";
  const initialEngine = available.find((c) => c.binary === defaultEngine)
    ? defaultEngine
    : fallbackEngine;

  // Pre-fill workdir from the most recently active Topic, so most users
  // can just hit Enter on the new-topic dialog.
  const initialWorkdir = useMemo(() => {
    if (topics.length === 0) return "";
    return [...topics].sort((a, b) => b.updatedAt - a.updatedAt)[0].workdir || "";
  }, [topics]);

  const [workdir, setWorkdir] = useState<string>(initialWorkdir);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [danger, setDanger] = useState<boolean>(false);
  const [engineOverride, setEngineOverride] = useState<string>(initialEngine);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const pickDir = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (typeof sel === "string") setWorkdir(sel);
  };

  const canSubmit = !!workdir && available.length > 0;
  const submit = () => {
    if (!canSubmit) return;
    onCreate({
      title: title.trim(),
      engine: engineOverride,
      workdir,
      model: engineOverride === "claude" ? model.trim() || null : null,
      dangerMode: danger,
    });
  };

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>新建 Topic</h3>

        {available.length === 0 && (
          <div className="banner warn" style={{ marginLeft: 0, marginRight: 0, marginBottom: 12 }}>
            没有可用的 CLI（要求已安装且已登录）。请先在终端登录：
            <code style={{ fontFamily: "var(--mono)", background: "#fff", padding: "0 4px", marginLeft: 4 }}>claude /login</code>
          </div>
        )}

        <label>
          <span>工作目录</span>
          <div className="row-h">
            <input
              ref={inputRef}
              type="text"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              placeholder="/home/you/project"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
            <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={pickDir}>浏览…</button>
          </div>
        </label>

        <label>
          <span>引擎</span>
          <div className="engine-row" style={{ marginTop: 2 }}>
            {cliStatus.map((c) => {
              const disabled = !c.installed || !c.loggedIn;
              const checked = engineOverride === c.binary;
              return (
                <label
                  key={c.binary}
                  className={`engine-card ${checked ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                  title={!c.installed ? "未安装" : !c.loggedIn ? "未登录" : ""}
                >
                  <input
                    type="radio"
                    name="topic-engine"
                    value={c.binary}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => setEngineOverride(c.binary)}
                  />
                  <div className="engine-card-body">
                    <div className="engine-card-title">
                      <span className={`engine-pill ${c.binary === "claude" ? "engine-cc" : "engine-cx"}`}>
                        {c.binary === "claude" ? "CC" : "CX"}
                      </span>
                      <span>{c.name}</span>
                    </div>
                    <div className="engine-card-status">
                      {!c.installed ? "未安装" : !c.loggedIn ? "未登录" : "已登录"}
                      {c.version && <span className="engine-card-ver"> · {c.version}</span>}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </label>

        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: -4, marginBottom: 10 }}>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setAdvancedOpen((v) => !v); }}
            style={{ color: "var(--salmon-700)" }}
          >
            {advancedOpen ? "收起高级" : "高级"}
          </a>
          {!advancedOpen && <span> · 标题、模型、危险模式</span>}
        </div>

        {advancedOpen && (
          <div style={{ borderTop: "1px solid var(--ink-100)", paddingTop: 10 }}>
            <label>
              <span>标题（可空，首轮对话后自动生成）</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：refactor auth middleware" />
            </label>

            {engineOverride === "claude" && (
              <label>
                <span>模型（可空 = 用 CLI 默认）</span>
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="例如：sonnet, opus, claude-sonnet-4-6" />
              </label>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={danger} onChange={(e) => setDanger(e.target.checked)} />
              <span style={{ marginBottom: 0 }}>
                危险模式（等价 <code>--dangerously-skip-permissions</code>，绕过权限审批）
              </span>
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn primary" disabled={!canSubmit} onClick={submit}>
            创建并启动
          </button>
        </div>
      </div>
    </div>
  );
}
