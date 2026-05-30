// Hook that aggregates the data the Ubuntu Desktop AI Brief widget shows:
// next meeting, unread mail count, pending tasks for today, recent pending
// recommendations. One call per data source, cached for ~60s — the widget
// re-renders on visibility change instead of hammering the backend.
//
// The widget itself decides which of (idle / collapsed / overview) state to
// render based on the total count of meaningful items.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { CalEvent, MailListItem, Recommendation, Task } from "./types";

export interface BriefSnapshot {
  unreadMail: number;
  /** Next upcoming event in the next 24h. Null if nothing scheduled. */
  nextEvent: CalEvent | null;
  /** A few starred / latest mails to show inline. Capped at 3. */
  recentMail: MailListItem[];
  /** Pending tasks due today (or overdue). Capped at 5. */
  todayTasks: Task[];
  /** Pending AI recommendations, capped at 3. */
  recs: Recommendation[];
  /** True while at least one source is still loading on first paint. */
  loading: boolean;
  /** Last successful refresh ms. */
  refreshedAt: number | null;
}

const EMPTY: BriefSnapshot = {
  unreadMail: 0,
  nextEvent: null,
  recentMail: [],
  todayTasks: [],
  recs: [],
  loading: true,
  refreshedAt: null,
};

const REFRESH_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function useDesktopBrief(enabled: boolean): BriefSnapshot & { refresh: () => void } {
  const [snap, setSnap] = useState<BriefSnapshot>(EMPTY);
  const inflightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const now = Date.now();
      const dayStart = startOfDay(now);
      const dayEnd = dayStart + DAY_MS;

      // Fire everything in parallel. Each .catch isolates failures so one
      // missing/unconfigured source doesn't blank the whole widget.
      const [accountsRes, eventsRes, tasksRes, recsRes] = await Promise.all([
        api.listMailAccounts().catch(() => []),
        api.listCalendarEvents(now, now + DAY_MS).catch(() => []),
        api.listTasks(null, false).catch(() => []),
        api.listPendingRecommendations().catch(() => []),
      ]);

      const unreadMail = accountsRes.reduce((sum, a) => sum + (a.unreadCount || 0), 0);

      // Pull a couple of latest unread mails for inline display. Best-effort
      // — only ask the first account, capped at 3.
      let recentMail: MailListItem[] = [];
      if (accountsRes.length > 0) {
        try {
          const inbox = await api.listInboxMessages(accountsRes[0].id, 5);
          recentMail = inbox.filter((m) => m.unread).slice(0, 3);
        } catch {
          recentMail = [];
        }
      }

      const nextEvent = (eventsRes as CalEvent[])
        .filter((e) => e.startMs >= now)
        .sort((a, b) => a.startMs - b.startMs)[0] || null;

      const todayTasks = (tasksRes as Task[])
        .filter((t) => !t.completed && (t.dueMs == null || t.dueMs <= dayEnd))
        .sort((a, b) => (a.dueMs || Infinity) - (b.dueMs || Infinity))
        .slice(0, 5);

      const recs = (recsRes as Recommendation[]).slice(0, 3);

      setSnap({
        unreadMail,
        nextEvent,
        recentMail,
        todayTasks,
        recs,
        loading: false,
        refreshedAt: Date.now(),
      });
    } finally {
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, refresh]);

  return { ...snap, refresh };
}

/** Total count used by the widget to pick its state (idle/collapsed/overview). */
export function briefItemCount(snap: BriefSnapshot): number {
  return (
    (snap.unreadMail > 0 ? 1 : 0) +
    (snap.nextEvent ? 1 : 0) +
    snap.todayTasks.length +
    snap.recs.length
  );
}
