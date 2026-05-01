import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { CliInfo } from "../lib/types";

interface Props {
  cliStatus: CliInfo[];
  onCancel: () => void;
  onCreate: (args: {
    title: string;
    engine: string;
    workdir: string;
    model: string | null;
    dangerMode: boolean;
  }) => void;
}

export function NewTopicDialog({ cliStatus, onCancel, onCreate }: Props) {
  const available = cliStatus.filter((c) => c.installed && c.loggedIn);
  const [engine, setEngine] = useState<string>(available[0]?.binary || "claude");
  const [workdir, setWorkdir] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [danger, setDanger] = useState<boolean>(false);

  useEffect(() => {
    // Default workdir to user home
    const home = (window as any).__SALMON_HOME__;
    if (home) setWorkdir(home);
  }, []);

  const pickDir = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (typeof sel === "string") setWorkdir(sel);
  };

  const canSubmit = engine && workdir && available.length > 0;

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
          <span>引擎</span>
          <select value={engine} onChange={(e) => setEngine(e.target.value)}>
            {cliStatus.map((c) => (
              <option key={c.binary} value={c.binary} disabled={!c.installed || !c.loggedIn}>
                {c.name} {!c.installed ? "（未安装）" : !c.loggedIn ? "（未登录）" : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>工作目录</span>
          <div className="row-h">
            <input type="text" value={workdir} onChange={(e) => setWorkdir(e.target.value)} placeholder="/home/you/project" />
            <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={pickDir}>浏览…</button>
          </div>
        </label>

        <label>
          <span>标题（可空，自动生成）</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：refactor auth middleware" />
        </label>

        {engine === "claude" && (
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

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <button
            className="btn primary"
            disabled={!canSubmit}
            onClick={() =>
              onCreate({
                title: title.trim() || "新 Topic",
                engine,
                workdir,
                model: model.trim() || null,
                dangerMode: danger,
              })
            }
          >
            创建并启动
          </button>
        </div>
      </div>
    </div>
  );
}
