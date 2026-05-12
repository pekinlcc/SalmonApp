/**
 * v0.9.0-alpha.1 stub. Calendar wiring lands in alpha.5.
 */
export function CalendarView() {
  return (
    <div className="empty-feature">
      <div className="empty-icon">📅</div>
      <div className="empty-title">日历</div>
      <div className="empty-sub">
        SalmonApp v0.9 将集成 Google Calendar / Outlook 日历。
        <br />
        添加邮箱账号后，日历会和邮件共用 OAuth。
      </div>
      <div className="empty-actions">
        <button
          className="btn primary"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("salmon:open-settings", { detail: "accounts" }));
          }}
        >
          去 设置 → 账号 添加邮箱
        </button>
      </div>
    </div>
  );
}
