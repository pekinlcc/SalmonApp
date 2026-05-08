import type { ChatLayout, CliInfo, UsageSummary } from "../lib/types";

interface Props {
  chatLayout: ChatLayout;
  defaultEngine: string;
  cliStatus: CliInfo[];
  usageSummary: UsageSummary | null;
  onChangeChatLayout: (layout: ChatLayout) => void;
  onChangeDefaultEngine: (engine: string) => void;
  onClose: () => void;
}

export function SettingsDialog({
  chatLayout,
  defaultEngine,
  cliStatus,
  usageSummary,
  onChangeChatLayout,
  onChangeDefaultEngine,
  onClose,
}: Props) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h3>设置</h3>

        <section className="settings-section">
          <div className="settings-section-title">默认引擎</div>
          <div className="settings-section-desc">
            "新建 Topic"弹窗的默认值。每个 Topic 一旦创建,引擎就锁死(因为 CLI 的 session resume 是按引擎绑死的);这里改的只影响下一次新建。
          </div>
          <div className="engine-row">
            {cliStatus.map((c) => {
              const disabled = !c.installed || !c.loggedIn;
              const checked = defaultEngine === c.binary;
              return (
                <label
                  key={c.binary}
                  className={`engine-card ${checked ? "selected" : ""} ${disabled ? "disabled" : ""}`}
                >
                  <input
                    type="radio"
                    name="default-engine"
                    value={c.binary}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onChangeDefaultEngine(c.binary)}
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
        </section>

        <section className="settings-section">
          <div className="settings-section-title">对话布局</div>
          <div className="settings-section-desc">
            助手的回复在中间栏的展示方式。两种风格,工具调用和最终结论的视觉权重不一样。
          </div>

          <label className={`layout-card ${chatLayout === "thinking" ? "selected" : ""}`}>
            <input
              type="radio"
              name="chat-layout"
              value="thinking"
              checked={chatLayout === "thinking"}
              onChange={() => onChangeChatLayout("thinking")}
            />
            <div className="layout-card-body">
              <div className="layout-card-title">
                折叠"思考过程" + 突出最终答案
                <span className="badge default">默认</span>
              </div>
              <div className="layout-card-desc">
                中间执行的工具调用全部折叠成一个 disclosure(默认展开,可关),最终的文字结论靠下与思考块的距离 + 字重突出。<br />
                适合:看完答案就走,工具过程当注脚。
              </div>
            </div>
          </label>

          <label className={`layout-card ${chatLayout === "inline" ? "selected" : ""}`}>
            <input
              type="radio"
              name="chat-layout"
              value="inline"
              checked={chatLayout === "inline"}
              onChange={() => onChangeChatLayout("inline")}
            />
            <div className="layout-card-body">
              <div className="layout-card-title">
                内联时序交错(Cherry Studio / Claude.ai 风)
              </div>
              <div className="layout-card-desc">
                每段文字 + 每个工具调用按到达顺序自然排列。能完整还原 AI"先看 X→再 grep Y→给结论"的演化路径。<br />
                适合:复盘/调试 AI 思路,工具过程是主体。
              </div>
            </div>
          </label>
        </section>

        {usageSummary && (
          <section className="settings-section">
            <div className="settings-section-title">用量</div>
            <div className="settings-section-desc">
              累计 token 消耗。按 Topic 排序，前 50 名。
            </div>
            <div className="usage-summary-row">
              <span>今日 <b>{compact(usageSummary.todayIn + usageSummary.todayOut)}</b></span>
              <span>近 7 天 <b>{compact(usageSummary.weekIn + usageSummary.weekOut)}</b></span>
              <span>近 30 天 <b>{compact(usageSummary.monthIn + usageSummary.monthOut)}</b></span>
              <span>累计 <b>{compact(usageSummary.totalIn + usageSummary.totalOut)}</b></span>
            </div>
            {usageSummary.byTopic.length === 0 ? (
              <div className="settings-section-desc" style={{ marginTop: 6 }}>
                还没有可统计的 token 数据。等几次对话之后再回来看。
              </div>
            ) : (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th>引擎</th>
                    <th style={{ textAlign: "right" }}>输入</th>
                    <th style={{ textAlign: "right" }}>输出</th>
                    <th style={{ textAlign: "right" }}>合计</th>
                  </tr>
                </thead>
                <tbody>
                  {usageSummary.byTopic.map((t) => (
                    <tr key={t.topicId}>
                      <td className="usage-topic-cell" title={t.topicTitle}>{t.topicTitle || "(未命名)"}</td>
                      <td>
                        <span className={`engine-pill ${t.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                          {t.engine === "claude" ? "CC" : "CX"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>{compact(t.totalIn)}</td>
                      <td style={{ textAlign: "right" }}>{compact(t.totalOut)}</td>
                      <td style={{ textAlign: "right" }}><b>{compact(t.totalIn + t.totalOut)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
