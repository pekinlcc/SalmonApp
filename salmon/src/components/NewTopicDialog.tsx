import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { CliInfo } from "../lib/types";

interface Props {
  cliStatus: CliInfo[];
  defaultEngine: string;
  onCancel: () => void;
  onCreate: (args: {
    title: string;
    engine: string;
    workdir: string;
    model: string | null;
    dangerMode: boolean;
  }) => void;
}

export function NewTopicDialog({ cliStatus, defaultEngine, onCancel, onCreate }: Props) {
  const available = cliStatus.filter((c) => c.installed && c.loggedIn);
  const fallbackEngine = available[0]?.binary || "claude";
  const initialEngine = available.find((c) => c.binary === defaultEngine)
    ? defaultEngine
    : fallbackEngine;

  const [workdir, setWorkdir] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [title, setTitle] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [danger, setDanger] = useState<boolean>(false);
  const [engineOverride, setEngineOverride] = useState<string>(initialEngine);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
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
      model: model.trim() || null,
      dangerMode: danger,
    });
  };

  const engineLabel = (b: string) =>
    cliStatus.find((c) => c.binary === b)?.name || b;

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

        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: -4, marginBottom: 10 }}>
          引擎 <strong style={{ color: "var(--ink-700)" }}>{engineLabel(engineOverride)}</strong>
          {engineOverride !== defaultEngine && "（本次覆盖）"}
          {" · "}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setAdvancedOpen((v) => !v); }}
            style={{ color: "var(--salmon-700)" }}
          >
            {advancedOpen ? "收起高级" : "高级"}
          </a>
        </div>

        {advancedOpen && (
          <div style={{ borderTop: "1px solid var(--ink-100)", paddingTop: 10 }}>
            <label>
              <span>引擎（仅本 Topic）</span>
              <select value={engineOverride} onChange={(e) => setEngineOverride(e.target.value)}>
                {cliStatus.map((c) => (
                  <option key={c.binary} value={c.binary} disabled={!c.installed || !c.loggedIn}>
                    {c.name}{!c.installed ? "（未安装）" : !c.loggedIn ? "（未登录）" : ""}
                  </option>
                ))}
              </select>
            </label>

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
