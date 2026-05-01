import type { CliInfo } from "../lib/types";

interface Props {
  cliStatus: CliInfo[];
  onContinue: () => void;
  onRefresh: () => void;
}

export function Onboarding({ cliStatus, onContinue, onRefresh }: Props) {
  const ready = cliStatus.some((c) => c.installed && c.loggedIn);
  return (
    <div className="onb">
      <div className="onb-card">
        <div className="onb-title">欢迎使用 Salmon</div>
        <div className="onb-sub">
          Salmon 不存任何 API Key——它会复用你已经在终端登录好的 CLI。下面是检测结果：
        </div>

        {cliStatus.map((c) => {
          const cls = !c.installed ? "miss" : c.loggedIn ? "ok" : "warn";
          return (
            <div key={c.binary} className={`onb-cli ${cls}`}>
              <div className="onb-cli-row">
                <span className={`engine-pill ${c.binary === "claude" ? "engine-cc" : "engine-cx"}`}>
                  {c.binary === "claude" ? "CC" : "CX"}
                </span>
                <span className="onb-cli-name">{c.name} CLI</span>
                <span
                  className={`onb-status ${cls}`}
                >
                  {!c.installed ? "未安装" : c.loggedIn ? "已登录" : "未登录"}
                </span>
                {c.version && (
                  <span style={{ marginLeft: "auto", color: "var(--ink-500)", fontSize: 11.5 }}>
                    {c.version.split("\n")[0].slice(0, 24)}
                  </span>
                )}
              </div>
              {c.installed && !c.loggedIn && (
                <div className="onb-cmd">
                  <span><span style={{ color: "#FFA68A" }}>$</span> {c.binary === "claude" ? "claude /login" : "codex login"}</span>
                  <span className="copy" onClick={() => copy(c.binary === "claude" ? "claude /login" : "codex login")}>复制</span>
                </div>
              )}
              {!c.installed && (
                <div className="onb-cmd">
                  <span style={{ color: "var(--ink-500)" }}>未检测到 {c.binary} 命令</span>
                </div>
              )}
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onRefresh}>重新检测</button>
          <button className="btn primary" disabled={!ready} onClick={onContinue} style={{ marginLeft: "auto" }}>
            {ready ? "创建第一个 Topic →" : "至少需要一个已登录的 CLI"}
          </button>
        </div>
      </div>
    </div>
  );
}

function copy(s: string) {
  navigator.clipboard?.writeText(s).catch(() => {});
}
