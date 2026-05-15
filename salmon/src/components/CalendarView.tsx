import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { CalEvent, MailAccount } from "../lib/types";

/**
 * v0.10.0 — calendar with proper week grid: hour ruler on the left,
 * one column per day, events absolutely positioned by start time and
 * duration. Plus manual event creation (click empty cell or "+ 新建").
 */
const HOUR_PX = 48;          // pixel height of one hour row
const FIRST_HOUR = 0;        // grid starts at midnight; we scroll to ~07:00 on mount
const HOURS_TOTAL = 24;
const ALL_DAY_BAND_H = 28;

interface CalendarViewProps {
  pendingOpenEvent?: { eventId?: string | null; accountId?: string | null; startMs?: number | null } | null;
  onConsumePendingOpenEvent?: () => void;
}

export function CalendarView({ pendingOpenEvent, onConsumePendingOpenEvent }: CalendarViewProps = {}) {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [view, setView] = useState<"week" | "agenda">("week");
  const [highlightEventId, setHighlightEventId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ start: Date; end: Date } | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalEvent | null>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const loadEvents = useCallback(async () => {
    try {
      const evs = await api.listCalendarEvents(weekStart.getTime(), weekEnd.getTime());
      setEvents(evs);
    } catch (e: any) { setError(String(e)); }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    (async () => {
      try { setAccounts(await api.listMailAccounts()); } catch {}
      await loadEvents();
    })();
  }, [loadEvents]);

  useEffect(() => {
    const onCalendarChanged = () => {
      loadEvents();
    };
    window.addEventListener("salmon:calendar-events-changed", onCalendarChanged);
    return () => window.removeEventListener("salmon:calendar-events-changed", onCalendarChanged);
  }, [loadEvents]);

  useEffect(() => {
    if (!pendingOpenEvent?.eventId && !pendingOpenEvent?.startMs) return;
    if (pendingOpenEvent.startMs) {
      setWeekStart(startOfWeek(new Date(pendingOpenEvent.startMs)));
      setView("week");
    }
    if (pendingOpenEvent.eventId) setHighlightEventId(pendingOpenEvent.eventId);
    onConsumePendingOpenEvent?.();
  }, [pendingOpenEvent, onConsumePendingOpenEvent]);

  useEffect(() => {
    if (!highlightEventId) return;
    const ev = events.find((x) => x.id === highlightEventId);
    if (ev) setDetailEvent(ev);
  }, [events, highlightEventId]);

  // Auto-scroll to ~07:00 so the user lands somewhere useful instead of midnight.
  useEffect(() => {
    if (view === "week" && gridScrollRef.current) {
      gridScrollRef.current.scrollTop = 7 * HOUR_PX - 20;
    }
  }, [view]);

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
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: "✓ 日历已从云端拉取最新", kind: "done" },
      }));
    } finally {
      setSyncing(false);
    }
  }, [accounts, loadEvents]);

  // Click empty hour cell → open compose pre-filled with that hour.
  const onCellClick = useCallback((day: Date, hour: number) => {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(hour + 1, 0, 0, 0);
    setComposing({ start, end });
  }, []);

  const onNewClick = useCallback(() => {
    const start = nextRoundHour(new Date());
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    setComposing({ start, end });
  }, []);

  if (accounts.length === 0) {
    return (
      <div className="empty-feature">
        <div className="empty-icon">📅</div>
        <div className="empty-title">日历</div>
        <div className="empty-sub">先到邮件里登录 Gmail / Outlook 账号 — 日历用同一份 OAuth。</div>
      </div>
    );
  }

  return (
    <div className="cal-shell">
      <div className="cal-head">
        <div className="cal-title">📅 日历</div>
        <div className="cal-nav">
          <button className="btn-ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ 上周</button>
          <button className="btn-ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>本周</button>
          <button className="btn-ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>下周 ›</button>
          <span className="cal-range">{fmtMD(weekStart)} – {fmtMD(addDays(weekEnd, -1))}</span>
        </div>
        <div className="cal-actions">
          <div className="cal-view-switch" role="tablist" aria-label="日历视图">
            <button
              className={view === "week" ? "active" : ""}
              role="tab"
              aria-selected={view === "week"}
              onClick={() => setView("week")}
            >
              周
            </button>
            <button
              className={view === "agenda" ? "active" : ""}
              role="tab"
              aria-selected={view === "agenda"}
              onClick={() => setView("agenda")}
            >
              列表
            </button>
          </div>
          <button className="btn primary" onClick={onNewClick}>＋ 新建</button>
          <button className="btn-ghost" onClick={onSyncAll} disabled={syncing}>
            {syncing ? "同步中…" : "↻ 同步"}
          </button>
        </div>
      </div>
      {error && <div className="cal-error">{error}</div>}
      {view === "week" ? (
        <WeekGrid
          weekStart={weekStart}
          events={events}
          gridScrollRef={gridScrollRef}
          highlightEventId={highlightEventId}
          onCellClick={onCellClick}
          onEventClick={setDetailEvent}
        />
      ) : (
        <Agenda
          events={events}
          accounts={accounts}
          highlightEventId={highlightEventId}
          onEventClick={setDetailEvent}
        />
      )}
      {composing && (
        <NewEventModal
          accounts={accounts}
          initialStart={composing.start}
          initialEnd={composing.end}
          onClose={() => setComposing(null)}
          onCreated={() => {
            setComposing(null);
            loadEvents();
          }}
        />
      )}
      {detailEvent && (
        <EventDetailModal
          ev={detailEvent}
          accounts={accounts}
          onClose={() => setDetailEvent(null)}
          onDeleted={() => {
            setEvents((cur) => cur.filter((x) => x.id !== detailEvent.id));
            setDetailEvent(null);
          }}
        />
      )}
    </div>
  );
}

// ── Week grid with hour ruler ───────────────────────────────────────

function WeekGrid({
  weekStart,
  events,
  gridScrollRef,
  highlightEventId,
  onCellClick,
  onEventClick,
}: {
  weekStart: Date;
  events: CalEvent[];
  gridScrollRef: React.RefObject<HTMLDivElement>;
  highlightEventId?: string | null;
  onCellClick: (day: Date, hour: number) => void;
  onEventClick: (ev: CalEvent) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = new Date().toDateString();

  // Bucket events: all-day as week-spanning segments, timed per day.
  const buckets = useMemo(() => {
    const timed = new Map<string, CalEvent[]>();
    for (const ev of events) {
      const dayKey = new Date(ev.startMs).toDateString();
      if (!ev.allDay) {
        if (!timed.has(dayKey)) timed.set(dayKey, []);
        timed.get(dayKey)!.push(ev);
      }
    }
    for (const arr of timed.values()) arr.sort((a, b) => a.startMs - b.startMs);
    return { timed };
  }, [events]);

  const allDaySegments = useMemo(
    () => assignAllDayLanes(events.filter((ev) => ev.allDay), weekStart),
    [events, weekStart],
  );
  const maxAllDayCount = Math.max(0, ...allDaySegments.map((s) => s.laneIdx + 1));
  const allDayHeight = ALL_DAY_BAND_H + maxAllDayCount * 22;

  // "Now" indicator line position.
  const nowLineTop = useMemo(() => {
    const now = new Date();
    const isThisWeek = days.some((d) => d.toDateString() === now.toDateString());
    if (!isThisWeek) return null;
    const minutes = now.getHours() * 60 + now.getMinutes();
    return (minutes / 60) * HOUR_PX;
  }, [days]);
  const nowColIdx = useMemo(() => {
    const now = new Date();
    return days.findIndex((d) => d.toDateString() === now.toDateString());
  }, [days]);

  return (
    <div className="cal-week-v2">
      {/* Sticky header row: empty corner + day names */}
      <div className="cal-week-header">
        <div className="cal-corner" />
        {days.map((d) => {
          const isToday = d.toDateString() === today;
          return (
            <div key={d.toDateString()} className={`cal-day-head-v2 ${isToday ? "today" : ""}`}>
              <span className="cal-day-name-v2">{dayName(d)}</span>
              <span className="cal-day-num-v2">{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      {/* All-day band */}
      <div className="cal-allday-row" style={{ height: allDayHeight }}>
        <div className="cal-allday-label">全天</div>
        <div className="cal-allday-grid">
          {days.map((d) => (
            <div key={d.toDateString()} className="cal-allday-cell" />
          ))}
          {allDaySegments.map(({ ev, startIdx, span, laneIdx }) => (
            <div
              key={ev.id}
              className={`cal-allday-pill ${ev.id === highlightEventId ? "highlight" : ""}`}
              title={ev.title || ""}
              style={{
                gridColumn: `${startIdx + 1} / span ${span}`,
                top: 3 + laneIdx * 22,
              }}
              onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
            >
              {ev.title || "(无标题)"}
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable body: hour ruler + day columns */}
      <div className="cal-grid-scroll" ref={gridScrollRef}>
        <div className="cal-grid-body" style={{ height: HOURS_TOTAL * HOUR_PX }}>
          {/* Hour ruler */}
          <div className="cal-ruler">
            {Array.from({ length: HOURS_TOTAL }, (_, h) => (
              <div key={h} className="cal-ruler-cell" style={{ height: HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((d, dayIdx) => {
            const evs = buckets.timed.get(d.toDateString()) || [];
            const isToday = d.toDateString() === today;
            return (
              <div key={d.toDateString()} className={`cal-day-col ${isToday ? "today" : ""}`}>
                {Array.from({ length: HOURS_TOTAL }, (_, h) => (
                  <div
                    key={h}
                    className="cal-hour-cell"
                    style={{ height: HOUR_PX }}
                    onClick={() => onCellClick(d, h + FIRST_HOUR)}
                    title={`新建事件 ${String(h).padStart(2, "0")}:00`}
                  />
                ))}
                {assignLanes(evs).map((p) => {
                  const ev = p.ev;
                  const start = new Date(ev.startMs);
                  const top = (start.getHours() * 60 + start.getMinutes()) / 60 * HOUR_PX;
                  const durMin = Math.max(20, (ev.endMs - ev.startMs) / 60_000);
                  const height = (durMin / 60) * HOUR_PX;
                  // Lane-based horizontal split: when N events overlap in
                  // time, the day column is split into N parallel lanes
                  // so each event gets its own slice instead of being
                  // hidden under the topmost one. (User reported "5/14
                  // has 2 events at 3am in Gmail but only 1 in SalmonApp"
                  // — that's the overlap blind spot this fixes.)
                  const widthPct = 100 / p.totalLanes;
                  const leftPct = p.laneIdx * widthPct;
                  return (
                    <div
                      key={ev.id}
                      className={`cal-event-block ${ev.id === highlightEventId ? "highlight" : ""}`}
                      style={{
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                      title={`${ev.title || "(无)"} ${fmtTime(ev.startMs)}–${fmtTime(ev.endMs)}${ev.location ? " @ " + ev.location : ""}`}
                      onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                    >
                      <div className="cal-event-time">{fmtTime(ev.startMs)}</div>
                      <div className="cal-event-title">{ev.title || "(无标题)"}</div>
                      {ev.location && p.totalLanes <= 2 && <div className="cal-event-loc">📍 {ev.location}</div>}
                    </div>
                  );
                })}
                {nowLineTop !== null && nowColIdx === dayIdx && (
                  <div className="cal-now-line" style={{ top: nowLineTop }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Agenda (compact list view) ──────────────────────────────────────

function Agenda({
  events,
  accounts,
  highlightEventId,
  onEventClick,
}: {
  events: CalEvent[];
  accounts: MailAccount[];
  highlightEventId?: string | null;
  onEventClick: (ev: CalEvent) => void;
}) {
  const acctMap = useMemo(() => {
    const m = new Map<string, MailAccount>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  if (events.length === 0) return <div className="cal-empty">本周没有日程。</div>;
  return (
    <div className="cal-agenda">
      {events.map((ev) => {
        const acct = acctMap.get(ev.accountId);
        return (
          <div
            key={ev.id}
            className={`cal-agenda-row ${ev.id === highlightEventId ? "highlight" : ""}`}
            onClick={() => onEventClick(ev)}
            style={{ cursor: "pointer" }}
          >
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventDetailModal({
  ev,
  accounts,
  onClose,
  onDeleted,
}: {
  ev: CalEvent;
  accounts: MailAccount[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const account = accounts.find((a) => a.id === ev.accountId);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function onDelete() {
    if (!confirm(`删除事件 "${ev.title || '(无标题)'}"？也会从 Google / Outlook 日历中删除。`)) return;
    setDeleting(true);
    try {
      await api.deleteCalendarEvent(ev.accountId, ev.id);
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: "✓ 已删除事件", kind: "done" },
      }));
      onDeleted();
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: `删除失败: ${e}`, kind: "error" },
      }));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="compose-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="compose-modal" style={{ width: 480 }}>
        <div className="compose-head">
          <div className="compose-title">📅 {ev.title || "(无标题)"}</div>
          <button className="btn-ghost" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: "14px 18px", fontSize: 13, lineHeight: 1.7 }}>
          <div>
            <b>时间：</b>
            {ev.allDay
              ? `${fmtMD(new Date(ev.startMs))}（全天）`
              : `${new Date(ev.startMs).toLocaleString("zh-CN")} – ${fmtTime(ev.endMs)}`}
          </div>
          {ev.location && <div><b>地点：</b>📍 {ev.location}</div>}
          {account && <div><b>账号：</b>{account.email}</div>}
          {ev.organizer && <div><b>组织者：</b>{ev.organizer}</div>}
          {ev.attendees.length > 0 && (
            <div>
              <b>与会：</b>
              {ev.attendees.slice(0, 8).map((a) => a.name || a.email).join("，")}
              {ev.attendees.length > 8 && ` (+${ev.attendees.length - 8})`}
            </div>
          )}
          {ev.description && (
            <div style={{ marginTop: 10, padding: 10, background: "#FAFAF9", borderRadius: 6, fontSize: 12.5 }}>
              {ev.description}
            </div>
          )}
        </div>
        <div className="compose-foot">
          <button className="btn" onClick={onDelete} disabled={deleting} style={{ color: "#B7493D" }}>
            {deleting ? "删除中…" : "🗑 删除事件"}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ── New event modal ────────────────────────────────────────────────

function NewEventModal({
  accounts,
  initialStart,
  initialEnd,
  onClose,
  onCreated,
}: {
  accounts: MailAccount[];
  initialStart: Date;
  initialEnd: Date;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(toDateInput(initialStart));
  const [startTime, setStartTime] = useState(toTimeInput(initialStart));
  const [endDate, setEndDate] = useState(toDateInput(initialEnd));
  const [endTime, setEndTime] = useState(toTimeInput(initialEnd));
  const [location, setLocation] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function onCreate() {
    setError(null);
    if (!title.trim()) { setError("标题不能为空"); return; }
    if (!accountId) { setError("没选账号"); return; }
    setCreating(true);
    try {
      const startMs = allDay
        ? new Date(`${startDate}T00:00:00`).getTime()
        : new Date(`${startDate}T${startTime}:00`).getTime();
      const endMs = allDay
        ? new Date(`${endDate}T00:00:00`).getTime()
        : new Date(`${endDate}T${endTime}:00`).getTime();
      if (isNaN(startMs) || isNaN(endMs)) {
        setError("起止时间无效");
        setCreating(false);
        return;
      }
      // For all-day events the user picks the SAME day for "an event on
      // May 12"; backend bumps end.date to make it exclusive. Only enforce
      // strict order for timed events.
      if (!allDay && endMs <= startMs) {
        setError("结束时间须晚于开始时间");
        setCreating(false);
        return;
      }
      if (allDay && endMs < startMs) {
        setError("结束日期不能早于开始日期");
        setCreating(false);
        return;
      }
      const ev = await api.createCalendarEvent({
        accountId,
        title: title.trim(),
        startMs,
        endMs,
        allDay,
        location: location.trim() || null,
      });
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: {
          title: `✓ 已加日历: ${title.trim()}`,
          kind: "done",
          actions: [{
            label: "查看日历",
            primary: true,
            target: { view: "calendar", eventId: ev.id, accountId, startMs },
          }],
        },
      }));
      onCreated();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="compose-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="compose-modal" style={{ width: 560 }}>
        <div className="compose-head">
          <div className="compose-title">新建日历事件</div>
          <button className="btn-ghost" onClick={onClose}>×</button>
        </div>
        <div className="compose-from">
          <span className="compose-label">账号:</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email} ({a.provider})</option>
            ))}
          </select>
        </div>
        <div className="compose-field">
          <span className="compose-label">标题:</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="例如：产品周会"
          />
        </div>
        <div className="compose-field">
          <span className="compose-label">全天:</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            全天事件
          </label>
        </div>
        <div className="compose-field">
          <span className="compose-label">开始:</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          {!allDay && (
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ marginLeft: 8 }} />
          )}
        </div>
        <div className="compose-field">
          <span className="compose-label">结束:</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          {!allDay && (
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ marginLeft: 8 }} />
          )}
        </div>
        <div className="compose-field">
          <span className="compose-label">地点:</span>
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="可选" />
        </div>
        {error && <div className="compose-error">{error}</div>}
        <div className="compose-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={creating}>取消</button>
          <button className="btn primary" onClick={onCreate} disabled={creating}>
            {creating ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
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
function nextRoundHour(d: Date): Date {
  const r = new Date(d);
  r.setMinutes(0, 0, 0);
  r.setHours(r.getHours() + 1);
  return r;
}
function fmtMD(d: Date): string { return `${d.getMonth() + 1}/${d.getDate()}`; }
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
function dayName(d: Date): string {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
}
function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toTimeInput(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function dayDiff(a: Date, b: Date): number {
  const aa = startOfDay(a).getTime();
  const bb = startOfDay(b).getTime();
  return Math.round((bb - aa) / 86_400_000);
}

function allDayEndExclusive(ev: CalEvent): Date {
  const start = startOfDay(new Date(ev.startMs));
  const rawEnd = new Date(ev.endMs);
  let end = startOfDay(rawEnd);
  if (ev.endMs <= ev.startMs) return addDays(start, 1);
  if (
    rawEnd.getHours() !== 0 ||
    rawEnd.getMinutes() !== 0 ||
    rawEnd.getSeconds() !== 0 ||
    rawEnd.getMilliseconds() !== 0
  ) {
    end = addDays(end, 1);
  }
  return end <= start ? addDays(start, 1) : end;
}

function assignAllDayLanes(
  events: CalEvent[],
  weekStart: Date,
): { ev: CalEvent; startIdx: number; span: number; laneIdx: number }[] {
  const weekEnd = addDays(weekStart, 7);
  const segments = events
    .map((ev) => {
      const start = startOfDay(new Date(ev.startMs));
      const end = allDayEndExclusive(ev);
      const visibleStart = start < weekStart ? weekStart : start;
      const visibleEnd = end > weekEnd ? weekEnd : end;
      if (visibleEnd <= visibleStart) return null;
      const startIdx = dayDiff(weekStart, visibleStart);
      const span = Math.max(1, dayDiff(visibleStart, visibleEnd));
      return { ev, startIdx, span };
    })
    .filter((s): s is { ev: CalEvent; startIdx: number; span: number } => s !== null)
    .sort((a, b) => a.startIdx - b.startIdx || b.span - a.span || a.ev.startMs - b.ev.startMs);

  const laneEnds: number[] = [];
  return segments.map((seg) => {
    const endIdx = seg.startIdx + seg.span;
    let laneIdx = laneEnds.findIndex((laneEnd) => laneEnd <= seg.startIdx);
    if (laneIdx === -1) {
      laneIdx = laneEnds.length;
      laneEnds.push(endIdx);
    } else {
      laneEnds[laneIdx] = endIdx;
    }
    return { ...seg, laneIdx };
  });
}

/**
 * Assign each event in a single day to a horizontal lane so overlapping
 * events appear side-by-side instead of on top of each other. Returns
 * each event annotated with its laneIdx + totalLanes for the cluster of
 * mutually-overlapping events it belongs to.
 *
 * Algorithm: sort by start; greedily place each event in the first lane
 * whose previous event has already ended; if no such lane, open a new
 * one. Events that don't overlap with anyone get totalLanes=1.
 *
 * Cluster boundaries: a "cluster" is a maximal run of events where each
 * touches at least one other (transitive). totalLanes is per-cluster so
 * one busy hour doesn't shrink the rest of the day's events.
 */
function assignLanes(events: CalEvent[]): { ev: CalEvent; laneIdx: number; totalLanes: number }[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const result: { ev: CalEvent; laneIdx: number; totalLanes: number }[] = [];
  // Group into clusters of transitively-overlapping events.
  let cluster: CalEvent[] = [];
  let clusterMaxEnd = -Infinity;
  const flushCluster = () => {
    if (cluster.length === 0) return;
    // Greedy lane assignment within the cluster.
    const laneEnds: number[] = [];
    const laneOf: number[] = [];
    for (const ev of cluster) {
      let lane = laneEnds.findIndex((end) => end <= ev.startMs);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(ev.endMs);
      } else {
        laneEnds[lane] = ev.endMs;
      }
      laneOf.push(lane);
    }
    const total = laneEnds.length;
    for (let i = 0; i < cluster.length; i++) {
      result.push({ ev: cluster[i], laneIdx: laneOf[i], totalLanes: total });
    }
    cluster = [];
    clusterMaxEnd = -Infinity;
  };
  for (const ev of sorted) {
    if (cluster.length === 0 || ev.startMs < clusterMaxEnd) {
      cluster.push(ev);
      if (ev.endMs > clusterMaxEnd) clusterMaxEnd = ev.endMs;
    } else {
      flushCluster();
      cluster.push(ev);
      clusterMaxEnd = ev.endMs;
    }
  }
  flushCluster();
  return result;
}
