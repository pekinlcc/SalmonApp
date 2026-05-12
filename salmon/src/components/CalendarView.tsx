import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { CalEvent, MailAccount } from "../lib/types";

/**
 * v0.9.0-alpha.5: read-only calendar. Week view + agenda fallback.
 * Sync window is 7d back / 90d forward; CRUD (create / RSVP) is a v0.10
 * item.
 */
export function CalendarView() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [view, setView] = useState<"week" | "agenda">("week");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);

  const loadEvents = useCallback(async () => {
    try {
      const startMs = weekStart.getTime();
      const endMs = weekEnd.getTime();
      const evs = await api.listCalendarEvents(startMs, endMs);
      setEvents(evs);
    } catch (e: any) {
      setError(String(e));
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    (async () => {
      try {
        const a = await api.listMailAccounts();
        setAccounts(a);
      } catch {}
      await loadEvents();
    })();
  }, [loadEvents]);

  const onSyncAll = useCallback(async () => {
    if (accounts.length === 0) return;
    setSyncing(true);
    setError(null);
    try {
      for (const a of accounts) {
        try { await api.syncCalendar(a.id); }
        catch (e: any) { api.debugLog(`cal sync ${a.email} failed: ${e}`); }
      }
      await loadEvents();
    } finally {
      setSyncing(false);
    }
  }, [accounts, loadEvents]);

  if (accounts.length === 0) {
    return (
      <div className="empty-feature">
        <div className="empty-icon">📅</div>
        <div className="empty-title">日历</div>
        <div className="empty-sub">先到邮件里登录 Gmail / Outlook 账号，日历会自动共用 OAuth。</div>
      </div>
    );
  }

  return (
    <div className="cal-shell">
      <div className="cal-head">
        <div className="cal-title">📅 日历</div>
        <div className="cal-nav">
          <button className="btn-ghost" onClick={() => {
            const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d);
          }}>‹ 上周</button>
          <button className="btn-ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>本周</button>
          <button className="btn-ghost" onClick={() => {
            const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d);
          }}>下周 ›</button>
          <span className="cal-range">{fmtMD(weekStart)} – {fmtMD(addDays(weekEnd, -1))}</span>
        </div>
        <div className="cal-actions">
          <button className={`btn-ghost ${view === "week" ? "active" : ""}`} onClick={() => setView("week")}>周视图</button>
          <button className={`btn-ghost ${view === "agenda" ? "active" : ""}`} onClick={() => setView("agenda")}>列表</button>
          <button className="btn primary" onClick={onSyncAll} disabled={syncing}>
            {syncing ? "同步中…" : "↻ 同步全部"}
          </button>
        </div>
      </div>
      {error && <div className="cal-error">{error}</div>}
      {view === "week" ? (
        <WeekGrid weekStart={weekStart} events={events} />
      ) : (
        <Agenda events={events} accounts={accounts} />
      )}
    </div>
  );
}

function WeekGrid({ weekStart, events }: { weekStart: Date; events: CalEvent[] }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date().toDateString();

  // Bucket events by day key.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const key = new Date(ev.startMs).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    for (const [, arr] of map) arr.sort((a, b) => a.startMs - b.startMs);
    return map;
  }, [events]);

  return (
    <div className="cal-week">
      {days.map((d) => {
        const key = d.toDateString();
        const evs = eventsByDay.get(key) || [];
        const isToday = key === today;
        return (
          <div key={key} className={`cal-day ${isToday ? "today" : ""}`}>
            <div className="cal-day-head">
              <span className="cal-day-name">{dayName(d)}</span>
              <span className="cal-day-num">{d.getDate()}</span>
            </div>
            <div className="cal-day-list">
              {evs.length === 0 ? (
                <div className="cal-day-empty">— 没有日程 —</div>
              ) : (
                evs.map((ev) => <EventPill key={ev.id} ev={ev} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventPill({ ev }: { ev: CalEvent }) {
  const time = ev.allDay
    ? "全天"
    : `${fmtTime(ev.startMs)} – ${fmtTime(ev.endMs)}`;
  return (
    <div className="cal-pill" title={ev.description || ev.title || ""}>
      <div className="cal-pill-time">{time}</div>
      <div className="cal-pill-title">{ev.title || "(无标题)"}</div>
      {ev.location && <div className="cal-pill-loc">📍 {ev.location}</div>}
    </div>
  );
}

function Agenda({ events, accounts }: { events: CalEvent[]; accounts: MailAccount[] }) {
  const acctMap = useMemo(() => {
    const m = new Map<string, MailAccount>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  if (events.length === 0) {
    return <div className="cal-empty">本周没有日程。</div>;
  }
  return (
    <div className="cal-agenda">
      {events.map((ev) => {
        const acct = acctMap.get(ev.accountId);
        return (
          <div key={ev.id} className="cal-agenda-row">
            <div className="cal-agenda-date">
              <div className="cal-agenda-md">{fmtMD(new Date(ev.startMs))}</div>
              <div className="cal-agenda-wd">{dayName(new Date(ev.startMs))}</div>
            </div>
            <div className="cal-agenda-body">
              <div className="cal-agenda-time">
                {ev.allDay ? "全天" : `${fmtTime(ev.startMs)} – ${fmtTime(ev.endMs)}`}
                {acct && <span className="cal-agenda-acct">{acct.email}</span>}
              </div>
              <div className="cal-agenda-title">{ev.title || "(无标题)"}</div>
              {ev.location && <div className="cal-agenda-loc">📍 {ev.location}</div>}
              {ev.attendees.length > 0 && (
                <div className="cal-agenda-att">
                  与会: {ev.attendees.slice(0, 5).map((a) => a.name || a.email).join(", ")}
                  {ev.attendees.length > 5 && ` (+${ev.attendees.length - 5})`}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day); // make Monday start
  const w = new Date(d);
  w.setHours(0, 0, 0, 0);
  w.setDate(w.getDate() + diff);
  return w;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function fmtMD(d: Date): string { return `${d.getMonth() + 1}/${d.getDate()}`; }
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
function dayName(d: Date): string {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
}
