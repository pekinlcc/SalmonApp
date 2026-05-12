/**
 * v0.9.0-alpha.1 stub. Real implementation lands once OAuth + Gmail/Graph
 * APIs are wired (alpha.2+). For now: empty state telling the user where
 * to add an account.
 */
export function MailView() {
  return (
    <div className="empty-feature">
      <div className="empty-icon">📧</div>
      <div className="empty-title">邮件</div>
      <div className="empty-sub">
        SalmonApp v0.9 即将集成 Gmail / Outlook 邮件 + AI 推荐。
        <br />
        当前是 alpha.1 基建版，UI 已经搭好，认证 + 同步在 alpha.2 上线。
      </div>
      <div className="empty-actions">
        <button
          className="btn primary"
          onClick={() => {
            // Settings → 账号 (added in this same release).
            window.dispatchEvent(new CustomEvent("salmon:open-settings", { detail: "accounts" }));
          }}
        >
          去 设置 → 账号 添加邮箱
        </button>
      </div>
      <div className="empty-roadmap">
        <h4>路线图</h4>
        <ul>
          <li>alpha.1（当前）— 侧栏 / 视图 / 设置基建</li>
          <li>alpha.2 — Gmail OAuth + 邮件 read</li>
          <li>alpha.3 — 邮件 read + 写 + 草稿</li>
          <li>alpha.4 — Outlook 接入</li>
          <li>alpha.5 — 日历完整 CRUD</li>
          <li>alpha.6 — 联系人 + 多账号 + AI 混合 briefing</li>
          <li>v0.9.0 — Polish + ship</li>
        </ul>
      </div>
    </div>
  );
}
