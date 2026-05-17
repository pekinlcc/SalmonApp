import { useEffect, useState } from "react";
import type { ChatLayout, CliInfo, ComposerSendMode, DailyUsage, UsageSummary } from "../lib/types";
import type { MailAccount, OauthStatus } from "../lib/types";
import { api } from "../lib/api";
import { playChime } from "../lib/notify";
import pkg from "../../package.json";

interface Props {
  chatLayout: ChatLayout;
  composerSendMode: ComposerSendMode;
  defaultEngine: string;
  cliStatus: CliInfo[];
  usageSummary: UsageSummary | null;
  notifySoundEnabled: boolean;
  onChangeChatLayout: (layout: ChatLayout) => void;
  onChangeComposerSendMode: (mode: ComposerSendMode) => void;
  onChangeDefaultEngine: (engine: string) => void;
  onChangeNotifySound: (enabled: boolean) => void;
  /** When set, settings opens on this tab instead of the default 用量. */
  initialTab?: string;
  onClose: () => void;
}

type Tab = "usage" | "preferences" | "accounts" | "about";

const TABS: Array<{ key: Tab; icon: string; label: string }> = [
  { key: "usage", icon: "📊", label: "用量" },
  { key: "preferences", icon: "⚙", label: "偏好" },
  { key: "accounts", icon: "🔑", label: "账号" },
  { key: "about", icon: "ℹ", label: "关于" },
];

export function SettingsDialog({
  chatLayout,
  composerSendMode,
  defaultEngine,
  cliStatus,
  usageSummary,
  notifySoundEnabled,
  onChangeChatLayout,
  onChangeComposerSendMode,
  onChangeDefaultEngine,
  onChangeNotifySound,
  initialTab,
  onClose,
}: Props) {
  // Default landing on 用量 — that's the "thing the user opened settings to
  // glance at quickly" in 9 cases out of 10. Preferences is a rarer click.
  const validInitial = (initialTab === "usage" || initialTab === "preferences" ||
    initialTab === "accounts" || initialTab === "about") ? initialTab : "usage";
  const [tab, setTab] = useState<Tab>(validInitial);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal settings-modal-v2" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-rail">
          <h4>设置</h4>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`rail-item ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <span className="rail-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
          <div className="rail-spacer" />
          <button className="btn btn-block" onClick={onClose}>关闭</button>
        </aside>

        <section className="settings-content-v2">
          {tab === "usage" && <UsageTab summary={usageSummary} />}
          {tab === "preferences" && (
            <PreferencesTab
              chatLayout={chatLayout}
              composerSendMode={composerSendMode}
              defaultEngine={defaultEngine}
              cliStatus={cliStatus}
              notifySoundEnabled={notifySoundEnabled}
              onChangeChatLayout={onChangeChatLayout}
              onChangeComposerSendMode={onChangeComposerSendMode}
              onChangeDefaultEngine={onChangeDefaultEngine}
              onChangeNotifySound={onChangeNotifySound}
            />
          )}
          {tab === "accounts" && <AccountsTab />}
          {tab === "about" && <AboutTab cliStatus={cliStatus} />}
        </section>
      </div>
    </div>
  );
}

function UsageTab({ summary }: { summary: UsageSummary | null }) {
  if (!summary) {
    return (
      <>
        <h3>用量</h3>
        <div className="sub">正在加载…</div>
      </>
    );
  }
  const cells: Array<{ label: string; tokens: number }> = [
    { label: "今日", tokens: summary.todayIn + summary.todayOut },
    { label: "近 7 天", tokens: summary.weekIn + summary.weekOut },
    { label: "近 30 天", tokens: summary.monthIn + summary.monthOut },
    { label: "累计", tokens: summary.totalIn + summary.totalOut },
  ];
  const empty = summary.totalIn + summary.totalOut === 0;
  return (
    <>
      <h3>用量</h3>
      <div className="sub">累计 token 消耗。按 Topic 排序，前 50 名。</div>
      <div className="usage-row" style={{ marginBottom: 14 }}>
        {cells.map((c) => (
          <div key={c.label} className="usage-cell" style={{ background: "var(--panel)", border: "1px solid var(--ink-100)", padding: 12, borderRadius: 6 }}>
            <div className="usage-cell-label">{c.label}</div>
            <div className="usage-cell-val" style={{ fontSize: 22 }}>{compact(c.tokens)}</div>
          </div>
        ))}
      </div>
      {summary.daily30.length > 0 && summary.daily30.some((d) => d.totalIn + d.totalOut > 0) && (
        <DailyChart days={summary.daily30} />
      )}
      {summary.byEngine.length > 0 && (
        <div className="usage-engine-row">
          {summary.byEngine.map((eu) => (
            <span key={eu.engine} className="usage-engine">
              <span className={`engine-pill ${eu.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                {eu.engine === "claude" ? "CC" : "CX"}
              </span>
              <span style={{ marginLeft: 6 }}>
                {compact(eu.totalIn + eu.totalOut)} ({compact(eu.totalIn)} in · {compact(eu.totalOut)} out)
              </span>
            </span>
          ))}
        </div>
      )}
      {empty ? (
        <div className="settings-section-desc" style={{ marginTop: 14 }}>
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
            {summary.byTopic.map((t) => (
              <tr key={t.topicId}>
                <td className="usage-topic-cell" title={t.topicTitle}>
                  {t.topicTitle || "(未命名)"}
                </td>
                <td>
                  <span className={`engine-pill ${t.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                    {t.engine === "claude" ? "CC" : "CX"}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>{compact(t.totalIn)}</td>
                <td style={{ textAlign: "right" }}>{compact(t.totalOut)}</td>
                <td style={{ textAlign: "right" }}>
                  <b>{compact(t.totalIn + t.totalOut)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function PreferencesTab({
  chatLayout,
  composerSendMode,
  defaultEngine,
  cliStatus,
  notifySoundEnabled,
  onChangeChatLayout,
  onChangeComposerSendMode,
  onChangeDefaultEngine,
  onChangeNotifySound,
}: {
  chatLayout: ChatLayout;
  composerSendMode: ComposerSendMode;
  defaultEngine: string;
  cliStatus: CliInfo[];
  notifySoundEnabled: boolean;
  onChangeChatLayout: (layout: ChatLayout) => void;
  onChangeComposerSendMode: (mode: ComposerSendMode) => void;
  onChangeDefaultEngine: (engine: string) => void;
  onChangeNotifySound: (enabled: boolean) => void;
}) {
  return (
    <>
      <h3>偏好</h3>
      <div className="sub">影响新建 Topic 和渲染行为的全局开关。</div>

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
          影响 assistant 消息里思考过程、工具调用和最终答案的呈现方式。Topic 内即时生效。
        </div>
        <div className="engine-row">
          <label className={`layout-card ${chatLayout === "thinking" ? "selected" : ""}`}>
            <input
              type="radio"
              name="chat-layout"
              value="thinking"
              checked={chatLayout === "thinking"}
              onChange={() => onChangeChatLayout("thinking")}
            />
            <div>
              <div className="layout-card-title">
                折叠思考 + 答案 <span className="badge default">默认</span>
              </div>
              <div className="layout-card-desc">
                所有工具调用收进"思考过程"折叠，最后一段文字作为答案。<br />
                适合:专注答案,过程作参考。
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
            <div>
              <div className="layout-card-title">
                内联时序交错(Cherry Studio / Claude.ai 风)
              </div>
              <div className="layout-card-desc">
                每段文字 + 每个工具调用按到达顺序自然排列。能完整还原 AI 思路演化。<br />
                适合:复盘 / 调试 AI 思路。
              </div>
            </div>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">发送快捷键</div>
        <div className="settings-section-desc">
          控制输入框里 Enter 的行为。Topic 内即时生效。
        </div>
        <div className="engine-row">
          <label className={`layout-card ${composerSendMode === "modEnter" ? "selected" : ""}`}>
            <input
              type="radio"
              name="composer-send-mode"
              value="modEnter"
              checked={composerSendMode === "modEnter"}
              onChange={() => onChangeComposerSendMode("modEnter")}
            />
            <div>
              <div className="layout-card-title">
                Cmd/Ctrl + Enter 发送 <span className="badge default">默认</span>
              </div>
              <div className="layout-card-desc">Enter 换行，适合长提示词。</div>
            </div>
          </label>
          <label className={`layout-card ${composerSendMode === "enter" ? "selected" : ""}`}>
            <input
              type="radio"
              name="composer-send-mode"
              value="enter"
              checked={composerSendMode === "enter"}
              onChange={() => onChangeComposerSendMode("enter")}
            />
            <div>
              <div className="layout-card-title">Enter 发送</div>
              <div className="layout-card-desc">Shift + Enter 换行，适合短消息节奏。</div>
            </div>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">通知声音</div>
        <div className="settings-section-desc">
          任务完成时播放一声短促的提示音。系统静音 / 关闭时无效；这里也能整体关闭。
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={notifySoundEnabled}
            onChange={(e) => onChangeNotifySound(e.target.checked)}
          />
          <span className="toggle-label">完成时播放提示音</span>
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              playChime();
            }}
          >
            试听
          </button>
        </label>
      </section>
    </>
  );
}

function AccountsTab() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [oauthStatus, setOauthStatus] = useState<OauthStatus>({
    googleConfigured: false,
    microsoftConfigured: false,
  });
  const [oauthConfigPath, setOauthConfigPath] = useState("oauth_config.toml");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"gmail" | "outlook" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [status, rows, configPath] = await Promise.all([
        api.getOauthStatus(),
        api.listMailAccounts(),
        api.getOauthConfigPath().catch(() => "oauth_config.toml"),
      ]);
      setOauthStatus(status);
      setAccounts(rows);
      setOauthConfigPath(configPath);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addAccount = async (provider: "gmail" | "outlook") => {
    setBusy(provider);
    setError(null);
    try {
      // v1.17.1: pre-emptively clear any half-finished OAuth flow. If the
      // user closed the previous browser tab without finishing, the
      // broker's pending slot would otherwise survive and brick this
      // attempt with "another OAuth attempt is already in progress". Safe
      // to call even when nothing is in flight — it's a no-op then.
      await api.cancelPendingOauth().catch(() => {});
      const account = provider === "gmail"
        ? await api.startGmailOauth()
        : await api.startOutlookOauth();
      setAccounts((cur) => cur.find((a) => a.id === account.id) ? cur : [...cur, account]);
      api.syncMailAccount(account.id).catch(() => {});
      api.syncContacts(account.id).catch(() => {});
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const removeAccount = async (account: MailAccount) => {
    if (!confirm(`移除 ${account.email}？本地缓存的邮件、日历、联系人和待办会一起删除。`)) return;
    setBusy("delete");
    setError(null);
    try {
      await api.deleteMailAccount(account.id);
      setAccounts((cur) => cur.filter((a) => a.id !== account.id));
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h3>邮箱账号</h3>
      <div className="sub">
        管理 Gmail / Outlook OAuth 账号。邮件、日历、联系人和待办共用这里的授权。
      </div>

      <section className="settings-section">
        <div className="settings-section-title">添加账号</div>
        <div className="account-provider-grid">
          <ProviderCard
            label="Gmail"
            badge="G"
            configured={oauthStatus.googleConfigured}
            busy={busy === "gmail"}
            disabled={busy !== null || !oauthStatus.googleConfigured}
            onClick={() => addAccount("gmail")}
          />
          <ProviderCard
            label="Outlook"
            badge="O"
            configured={oauthStatus.microsoftConfigured}
            busy={busy === "outlook"}
            disabled={busy !== null || !oauthStatus.microsoftConfigured}
            onClick={() => addAccount("outlook")}
          />
        </div>
        {(!oauthStatus.googleConfigured || !oauthStatus.microsoftConfigured) && (
          <div className="settings-section-desc" style={{ marginTop: 8 }}>
            未配置的服务需要先填写 <code>{oauthConfigPath}</code>，重启 SalmonApp 后生效。安装版 Mac 不读取源码目录；设置方法见仓库根目录 <code>OAUTH-SETUP.md</code>。
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => navigator.clipboard?.writeText(oauthConfigPath).catch(() => {})}
            >
              复制路径
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">已连接账号</div>
        {loading ? (
          <div className="settings-section-desc">正在加载…</div>
        ) : accounts.length === 0 ? (
          <div className="account-empty">还没有连接邮箱账号。</div>
        ) : (
          <div className="account-list">
            {accounts.map((a) => (
              <div className="account-row" key={a.id}>
                <span className={`provider-dot ${a.provider === "gmail" ? "gmail" : "outlook"}`}>
                  {a.provider === "gmail" ? "G" : "O"}
                </span>
                <div className="account-main">
                  <div className="account-email">{a.email}</div>
                  <div className="account-meta">
                    {a.provider} · 未读 {a.unreadCount}
                    {a.lastSyncAt ? ` · 最近同步 ${new Date(a.lastSyncAt).toLocaleString()}` : ""}
                  </div>
                  {a.lastSyncError && <div className="account-error">{a.lastSyncError}</div>}
                </div>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={busy !== null}
                  onClick={() => removeAccount(a)}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <div className="settings-error">{error}</div>}
      </section>
    </>
  );
}

function ProviderCard({
  label,
  badge,
  configured,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  badge: string;
  configured: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className="provider-card" disabled={disabled} onClick={onClick}>
      <span className={`provider-dot ${badge === "G" ? "gmail" : "outlook"}`}>{badge}</span>
      <div className="provider-main">
        <div className="provider-title">添加 {label}</div>
        <div className="provider-sub">
          {busy ? "等待浏览器授权…" : configured ? "OAuth 已配置" : "OAuth 未配置"}
        </div>
      </div>
      <span className={`provider-state ${configured ? "ready" : "missing"}`}>
        {configured ? "可添加" : "需配置"}
      </span>
    </button>
  );
}

function AboutTab({ cliStatus }: { cliStatus: CliInfo[] }) {
  const [dataDir, setDataDir] = useState<string>("");
  useEffect(() => {
    api.getAppDataDir().then(setDataDir).catch(() => {});
  }, []);
  return (
    <>
      <h3>关于</h3>
      <div className="sub">
        SalmonApp 是一个三栏式 Claude Code / Codex CLI 桌面客户端。
      </div>

      <div className="about-grid">
        <div className="about-row">
          <span className="about-k">版本</span>
          <span className="about-v"><b>v{pkg.version}</b></span>
        </div>
        {cliStatus.map((c) => (
          <div className="about-row" key={c.binary}>
            <span className="about-k">{c.name} CLI</span>
            <span className="about-v">
              <span className={`engine-pill ${c.binary === "claude" ? "engine-cc" : "engine-cx"}`}>
                {c.binary === "claude" ? "CC" : "CX"}
              </span>{" "}
              {!c.installed ? "未安装" : !c.loggedIn ? "未登录" : "已登录"}
              {c.version && <span style={{ color: "var(--ink-500)" }}> · {c.version}</span>}
            </span>
          </div>
        ))}
        <div className="about-row">
          <span className="about-k">数据目录</span>
          <span className="about-v about-mono" title={dataDir}>
            {dataDir || "(loading…)"}
          </span>
        </div>
        <div className="about-row">
          <span className="about-k">仓库</span>
          <span className="about-v">
            <a href="https://github.com/pekinlcc/SalmonApp" target="_blank" rel="noreferrer">
              github.com/pekinlcc/SalmonApp
            </a>
          </span>
        </div>
      </div>
    </>
  );
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * 30-day daily token bar chart. Each bar = (totalIn + totalOut) for a
 * day, scaled against the max day in the window. Hover a bar to see the
 * date + raw counts via the native `<title>` tooltip — no JS positioning
 * needed. Width is fluid (viewBox), parent decides actual size.
 */
function DailyChart({ days }: { days: DailyUsage[] }) {
  const W = 600;
  const H = 120;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 18; // room for x-axis labels
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const N = days.length || 30;
  const gap = 3;
  const barW = (W - gap * (N - 1)) / N;
  const max = days.reduce((m, d) => Math.max(m, d.totalIn + d.totalOut), 0);
  const safeMax = max > 0 ? max : 1;

  // Sparse x-axis labels: today, -7d, -14d, -21d, oldest. Five anchors.
  const labels: Array<{ x: number; text: string }> = [];
  if (days.length > 0) {
    const anchors = [0, Math.floor((N - 1) / 4), Math.floor((N - 1) / 2), Math.floor((3 * (N - 1)) / 4), N - 1];
    for (const i of anchors) {
      const d = days[i];
      if (!d) continue;
      // Show MM-DD; today gets "今日" instead.
      const text = i === N - 1 ? "今日" : d.date.slice(5);
      labels.push({ x: i * (barW + gap) + barW / 2, text });
    }
  }

  return (
    <div className="usage-chart-wrap">
      <div className="usage-chart-meta">
        <span className="usage-chart-title">近 30 天每日用量</span>
        <span className="usage-chart-max">峰值 {compact(max)}</span>
      </div>
      <svg
        className="usage-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="近 30 天每日 token 用量柱状图"
      >
        {/* baseline */}
        <line
          x1={0}
          x2={W}
          y1={H - PAD_BOTTOM + 0.5}
          y2={H - PAD_BOTTOM + 0.5}
          stroke="var(--ink-100)"
          strokeWidth={1}
        />
        {days.map((d, i) => {
          const total = d.totalIn + d.totalOut;
          const h = total > 0 ? Math.max(2, (total / safeMax) * innerH) : 0;
          const x = i * (barW + gap);
          const y = H - PAD_BOTTOM - h;
          const isToday = i === days.length - 1;
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={1.5}
              className={`usage-bar ${total === 0 ? "empty" : ""} ${isToday ? "today" : ""}`}
            >
              <title>
                {d.date}
                {"  "}· {compact(total)} tokens ({compact(d.totalIn)} in · {compact(d.totalOut)} out)
              </title>
            </rect>
          );
        })}
        {labels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={H - 4}
            textAnchor="middle"
            fontSize={10}
            fill="var(--ink-500)"
          >
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
