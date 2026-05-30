import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Block, BriefingProgress, ChatLayout, CliInfo, ComposerSendMode, Message, Recommendation, StreamEvent, ToolCall, Topic, UiMessage, UsageSummary } from "./lib/types";
import { api } from "./lib/api";
import { notify, setNotifySoundEnabled, type NotifyOpts, type ToastActionTarget, type ToastEvent } from "./lib/notify";
import { LeftSidebar } from "./components/LeftSidebar";
import { IconRail } from "./components/IconRail";
import { AppWindowTitleBar } from "./components/AppWindowTitleBar";
import { ContactsView } from "./components/ContactsView";
import { ChatStream } from "./components/ChatStream";
import { Composer } from "./components/Composer";
import { RightPane } from "./components/RightPane";
import { NewTopicDialog } from "./components/NewTopicDialog";
import { Onboarding } from "./components/Onboarding";
import { PromptDialog } from "./components/PromptDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { WelcomeBack } from "./components/WelcomeBack";
import { MailView } from "./components/MailView";
import { CalendarView } from "./components/CalendarView";
import { TasksView } from "./components/TasksView";
import { Toasts } from "./components/Toasts";
import { SearchDialog } from "./components/SearchDialog";
import { GlobalAIButton, type GlobalAIContext } from "./components/GlobalAIButton";
// v1.20: Ubuntu Desktop shell — high-fidelity port from Anthropic Claude Design.
import { DesktopView } from "./components/desktop-shell/DesktopView";
import { IS_LINUX } from "./lib/platform";
import { viewFromHash } from "./lib/openAppWindow";

interface PendingPerm {
  id: string;
  tool: string;
  input: any;
  command: string | null;
}

export default function App() {
  const [cliStatus, setCliStatus] = useState<CliInfo[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [defaultEngine, setDefaultEngine] = useState<string>("claude");
  const [chatLayout, setChatLayout] = useState<ChatLayout>("thinking");
  const [notifySoundEnabled, setNotifySoundEnabledState] = useState<boolean>(true);
  const [composerSendMode, setComposerSendMode] = useState<ComposerSendMode>("modEnter");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  // Stub views (MailView / CalendarView) dispatch a "salmon:open-settings"
  // custom event so they can prompt the user without taking a callback
  // through three layers of props. detail is the rail-item key to land on.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSettingsInitialTab(typeof detail === "string" ? detail : undefined);
      setShowSettings(true);
    };
    window.addEventListener("salmon:open-settings", handler);
    return () => window.removeEventListener("salmon:open-settings", handler);
  }, []);
  // v0.9.1: briefing pipeline state lives HERE (not in BriefingFeed)
  // because BriefingFeed unmounts when the user navigates to a Topic;
  // the LLM pipeline keeps running in the backend and the in-flight
  // indicator needs to survive that navigation.
  const [briefingRunning, setBriefingRunning] = useState(false);
  const [briefingProgress, setBriefingProgress] = useState<BriefingProgress | null>(null);
  const [briefingTick, setBriefingTick] = useState(0); // bump → tells BriefingFeed to re-read items
  useEffect(() => {
    let un: UnlistenFn | undefined;
    listen<BriefingProgress>("salmon-briefing-progress", (e) => {
      setBriefingProgress(e.payload);
      if (e.payload.stage === "starting") {
        setBriefingRunning(true);
      } else if (e.payload.stage === "done") {
        setBriefingRunning(false);
        setBriefingTick((n) => n + 1);
      }
    }).then((u) => { un = u; });
    return () => { un?.(); };
  }, []);
  const runBriefing = useCallback(async () => {
    setBriefingRunning(true);
    setBriefingProgress({ stage: "starting", current: 0, total: 0, note: null });
    try {
      await api.runBriefing();
    } catch (e: any) {
      api.debugLog(`runBriefing failed: ${e}`);
    } finally {
      // Don't blindly setBriefingRunning(false) — the salmon-briefing-progress
      // listener flips that on stage='done'. The await above resolves *with*
      // the done event in normal flow; in error paths setRunning above is
      // an extra safety net.
      setBriefingRunning(false);
    }
  }, []);

  // v0.9.0-alpha.6: home-feed cards dispatch open-mail / open-calendar
  // so cards in the briefing can deep-link into the right top-level view.
  useEffect(() => {
    const openMail = () => { setSelectedId(null); setSelectedTool(null); setTopView("mail"); };
    const openCal = () => { setSelectedId(null); setSelectedTool(null); setTopView("calendar"); };
    // v0.9.1: BriefingFeed dispatches salmon:open-compose-reply with
    //   detail = { replyToMailId, bodyText }
    // We switch to mail view AND stash the payload so MailView, which
    // doesn't exist yet at this instant, can pick it up on mount. An
    // earlier version dispatched the same event from inside MailView's
    // useEffect — but the event had already fired before MailView mounted,
    // so the listener silently missed it.
    const openCompose = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSelectedId(null);
      setSelectedTool(null);
      setTopView("mail");
      setPendingComposeReply(detail || null);
    };
    // v1.1.1: brief-card RelatedMailList rows fire this to jump from the
    // home / contacts view into the Mail view with that mail pre-selected.
    // Same stash-and-pickup dance as openCompose — MailView may not be
    // mounted yet at the instant of dispatch.
    const openMailMessage = (e: Event) => {
      const detail = (e as CustomEvent).detail as { messageId?: string; accountId?: string } | null;
      if (!detail?.messageId || !detail?.accountId) return;
      setSelectedId(null);
      setSelectedTool(null);
      setTopView("mail");
      setPendingOpenMail({ messageId: detail.messageId, accountId: detail.accountId });
    };
    window.addEventListener("salmon:open-mail", openMail);
    window.addEventListener("salmon:open-calendar", openCal);
    window.addEventListener("salmon:open-compose-reply", openCompose);
    window.addEventListener("salmon:open-mail-message", openMailMessage);
    return () => {
      window.removeEventListener("salmon:open-mail", openMail);
      window.removeEventListener("salmon:open-calendar", openCal);
      window.removeEventListener("salmon:open-compose-reply", openCompose);
      window.removeEventListener("salmon:open-mail-message", openMailMessage);
    };
  }, []);
  const [pendingComposeReply, setPendingComposeReply] = useState<{ replyToMailId: string; bodyText?: string } | null>(null);
  const [pendingOpenMail, setPendingOpenMail] = useState<{ messageId?: string | null; accountId?: string | null } | null>(null);
  const [pendingOpenCalendar, setPendingOpenCalendar] = useState<{ eventId?: string | null; accountId?: string | null; startMs?: number | null } | null>(null);
  const [pendingOpenTask, setPendingOpenTask] = useState<{ taskId?: string | null; accountId?: string | null } | null>(null);

  // v0.11.1: IconRail badges. Refreshed on mount + on relevant Tauri events.
  const [unreadMailBadge, setUnreadMailBadge] = useState(0);
  const [pendingTasksBadge, setPendingTasksBadge] = useState(0);
  const refreshBadges = useCallback(async () => {
    try {
      const accounts = await api.listMailAccounts();
      const unread = accounts.reduce((sum, a) => sum + (a.unreadCount || 0), 0);
      setUnreadMailBadge(unread);
    } catch {}
    try {
      const tasks = await api.listTasks(null, false);
      setPendingTasksBadge(tasks.filter((t) => !t.completed).length);
    } catch {}
  }, []);
  useEffect(() => {
    refreshBadges();
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    listen("salmon-mail-sync", () => refreshBadges()).then((u) => { un1 = u; });
    listen("salmon-mail-accounts", () => refreshBadges()).then((u) => { un2 = u; });
    // v1.19.1: any path that mutates tasks (TasksView toggle/create/delete,
    // CodeBlock salmon-action tasks.*, BriefingFeed TaskCreated step
    // result) dispatches salmon:tasks-changed so the rail badge refreshes
    // instantly instead of waiting up to 5 min on the fallback interval.
    const onTasksChanged = () => refreshBadges();
    window.addEventListener("salmon:tasks-changed", onTasksChanged);
    // v1.19.2: same pattern for mail mutations from chat (CodeBlock
    // mail.archive/star/mark_read/forward). The backend `salmon-mail-sync`
    // event only fires after an actual sync — direct mutations from
    // salmon-action don't trigger one — so the rail unread badge would
    // otherwise lag until the next periodic refresh.
    const onMailChanged = () => refreshBadges();
    window.addEventListener("salmon:mail-changed", onMailChanged);
    const t = setInterval(refreshBadges, 5 * 60 * 1000);
    return () => {
      un1?.(); un2?.();
      window.removeEventListener("salmon:tasks-changed", onTasksChanged);
      window.removeEventListener("salmon:mail-changed", onMailChanged);
      clearInterval(t);
    };
  }, [refreshBadges]);
  const [searchInitialQuery, setSearchInitialQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [workdirOkByTopic, setWorkdirOkByTopic] = useState<Record<string, boolean>>({});
  const [lastReadAt, setLastReadAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("salmon.lastReadAt") || "{}"); } catch { return {}; }
  });
  const markRead = useCallback((id: string) => {
    setLastReadAt((m) => {
      const next = { ...m, [id]: Date.now() };
      try { localStorage.setItem("salmon.lastReadAt", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const refreshUsageSummary = useCallback(async () => {
    try {
      const s = await api.getUsageSummary();
      setUsageSummary(s);
    } catch (e: any) {
      api.debugLog(`getUsageSummary failed: ${e}`);
    }
  }, []);
  const lastRecsRunRef = useRef<number>(0);

  // Topic id whose danger toggle was just flipped — drives the transient
  // "下次发送起生效" hint next to the button. Cleared by setTimeout.
  const [dangerHintTopicId, setDangerHintTopicId] = useState<string | null>(null);

  // In-app toasts (used instead of system notifications when the window is
  // focused — popping a system banner over the foreground app is annoying).
  const [toasts, setToasts] = useState<ToastEvent[]>([]);
  const pushToast = useCallback((t: ToastEvent) => {
    setToasts((cur) => [...cur, t]);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  // v0.9.1: BriefingFeed (and other components) push toasts via a custom
  // DOM event so they don't have to prop-drill the pushToast callback.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        title?: string;
        body?: string;
        kind?: string;
        actions?: ToastEvent["actions"];
      } | undefined;
      if (!detail?.title) return;
      const kind = (detail.kind && ["permission","done","error","crash","recs","info"].includes(detail.kind))
        ? (detail.kind as any) : "info";
      pushToast({
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        topicId: null,
        kind,
        title: detail.title,
        body: detail.body || "",
        createdAt: Date.now(),
        actions: Array.isArray(detail.actions) ? detail.actions : undefined,
      });
    };
    window.addEventListener("salmon:toast", handler);
    return () => window.removeEventListener("salmon:toast", handler);
  }, [pushToast]);

  // Window focus drives whether notify() emits a system banner or an in-app
  // toast. Keep a ref alongside state so event-handler callbacks defined
  // inside the dispatcher don't capture a stale snapshot.
  const windowFocusedRef = useRef<boolean>(true);
  useEffect(() => {
    const onFocus = () => { windowFocusedRef.current = true; };
    const onBlur = () => { windowFocusedRef.current = false; };
    windowFocusedRef.current = typeof document !== "undefined" ? document.hasFocus() : true;
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const refreshRecsList = useCallback(async () => {
    try {
      const list = await api.listPendingRecommendations();
      setRecommendations(list);
    } catch (e: any) {
      api.debugLog(`list recommendations failed: ${e}`);
    }
  }, []);

  const generateRecs = useCallback(async () => {
    if (recsLoading) return;
    setRecsLoading(true);
    setRecsError(null);
    lastRecsRunRef.current = Date.now();
    try {
      const out = await api.generateRecommendations();
      await refreshRecsList();
      if (out.length > 0) {
        fireNotify({
          topicId: null,
          kind: "recs",
          title: "SalmonApp · 新推荐",
          body: `${out.length} 条新建议待查看`,
        });
      }
    } catch (e: any) {
      setRecsError(String(e));
    } finally {
      setRecsLoading(false);
    }
  }, [recsLoading, refreshRecsList]);

  const onDecideRec = useCallback(async (id: string, decision: "accepted" | "ignored") => {
    setRecommendations((cur) => cur.filter((r) => r.id !== id));
    try {
      await api.decideRecommendation(id, decision);
    } catch (e: any) {
      api.debugLog(`decide failed: ${e}`);
      await refreshRecsList();
    }
  }, [refreshRecsList]);

  // Trigger rule: only when there's been new topic activity since last run,
  // AND fire on the next hour boundary (HH:00). On launch, if it's been ≥1h
  // since last run AND there's new activity, fire immediately so the home
  // page isn't stale; otherwise wait for the next hour mark.
  const topicsRef = useRef(topics);
  topicsRef.current = topics;
  // Mount effect: kick off the initial recs list refresh and start the
  // hourly tick. The "fire immediately on launch if stale" branch was
  // previously here too, but `topics` is loaded from the DB
  // asynchronously so on first mount `topicsRef.current` is `[]` and
  // `maxTopicUpdated()` returns 0 — the check silently fell through and
  // we ended up waiting for the next HH:00 tick. The launch-fire branch
  // moved to the topics-loaded effect below.
  useEffect(() => {
    refreshRecsList();
    refreshUsageSummary();
    const HOUR = 60 * 60 * 1000;
    const maxTopicUpdated = () =>
      topicsRef.current.reduce((m, t) => Math.max(m, t.updatedAt), 0);
    const readLast = () =>
      parseInt(localStorage.getItem("salmon.lastRecsRun") || "0", 10);
    const writeLast = () => {
      try { localStorage.setItem("salmon.lastRecsRun", String(Date.now())); } catch {}
    };

    let lastFiredHour = -1;
    const tick = () => {
      const now = new Date();
      if (now.getMinutes() !== 0) return;            // only on HH:00
      if (now.getHours() === lastFiredHour) return;  // de-dupe within the minute
      const last = readLast();
      if (maxTopicUpdated() <= last) return;          // no new activity
      lastFiredHour = now.getHours();
      generateRecs().then(writeLast);
      // We don't need HOUR here, but keep the symbol referenced so the
      // closure type-check passes if a future tick uses it.
      void HOUR;
    };
    const timer = setInterval(tick, 30 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Launch-fire branch: once topics finish loading (transition from `[]`
  // to non-empty for the first time after mount), evaluate the
  // ">1h since last run AND there's new activity" trigger. Guarded by a
  // ref so we only fire once per app session even if `topics` changes
  // again later.
  const launchRecFiredRef = useRef(false);
  useEffect(() => {
    if (launchRecFiredRef.current) return;
    if (topics.length === 0) return; // wait for first DB load
    launchRecFiredRef.current = true;
    const HOUR = 60 * 60 * 1000;
    const lastRun = parseInt(localStorage.getItem("salmon.lastRecsRun") || "0", 10);
    const maxUpdated = topics.reduce((m, t) => Math.max(m, t.updatedAt), 0);
    if (Date.now() - lastRun > HOUR && maxUpdated > lastRun) {
      generateRecs().then(() => {
        try { localStorage.setItem("salmon.lastRecsRun", String(Date.now())); } catch {}
      });
    }
  }, [topics, generateRecs]);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("salmon.rightCollapsed") === "1"; } catch { return false; }
  });
  const toggleRight = useCallback(() => {
    setRightCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("salmon.rightCollapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        toggleRight();
      }
      if (e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        getCurrentWindow().minimize().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRight]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [renamingTopicId, setRenamingTopicId] = useState<string | null>(null);
  // v0.9.0-alpha.1: top-level view. 'home' shows Welcome Back (existing
  // behaviour). 'mail' / 'calendar' show empty-state placeholders until
  // OAuth + sync land in alpha.2+. 'topic' means a CLI topic is open via
  // selectedId. Setting selectedId implicitly switches to 'topic'.
  // v0.11: top-level views now driven by IconRail. "topic" view shows
  // the Topic list pane + chat; opening a chat from any other view jumps
  // to this view via onSelect → setTopView("topic") + setSelectedId.
  type TopView = "home" | "contacts" | "mail" | "calendar" | "tasks" | "topic" | "desktop";
  // v1.20: on Linux we boot to the Ubuntu Desktop shell by default. The
  // actual decision is finalised after refresh() loads the persisted
  // setting — but pre-seeding here avoids a flash of WelcomeBack before
  // the async load settles on Linux. macOS / Windows always start in "home".
  //
  // Phase 3 multi-window: when this window was spawned by the Desktop shell
  // (URL hash like #view=mail), boot straight into that view and skip the
  // desktop chrome entirely. Each per-app window is independent.
  const initialHashView = viewFromHash();
  const [topView, setTopView] = useState<TopView>(
    initialHashView ? (initialHashView as TopView) : IS_LINUX ? "desktop" : "home",
  );
  const isAppWindow = initialHashView !== null;
  // True iff the desktop shell is permitted on this platform (user toggle
  // in Settings). null while we haven't loaded the persisted value yet.
  const [desktopModeEnabled, setDesktopModeEnabledState] = useState<boolean>(IS_LINUX);

  const [messagesByTopic, setMessagesByTopic] = useState<Record<string, UiMessage[]>>({});
  const [logsByTopic, setLogsByTopic] = useState<Record<string, string[]>>({});
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [spawningId, setSpawningId] = useState<string | null>(null);
  const [busyByTopic, setBusyByTopic] = useState<Record<string, boolean>>({});
  // v1.15.0: per-topic "engine anticipating" counter. Bumped by salmon-query
  // cards while they're mid-API-call so the typing dots stay on through
  // the window where the previous engine turn has emitted `exited` but
  // continueWithLocalContext hasn't fired yet. Without this, the dots
  // briefly disappear and users think the AI stopped.
  const [anticipatingByTopic, setAnticipatingByTopic] = useState<Record<string, number>>({});
  // v1.17.0: structured app-state snapshot for the global ⌘K AI button.
  // Updated by per-view onContextChange callbacks (MailView pushes the
  // currently-selected message in real time; other views default to
  // their kind without selection details). When the AI button submits,
  // we serialise this into a context-seed system message on the new
  // scratch Topic.
  const [mailContext, setMailContext] = useState<{ accountId?: string | null; messageId?: string | null; threadId?: string | null; subject?: string | null; fromEmail?: string | null; fromName?: string | null } | null>(null);
  const [pendingPermByTopic, setPendingPermByTopic] = useState<Record<string, PendingPerm | null>>({});
  const [errorByTopic, setErrorByTopic] = useState<Record<string, string | null>>({});
  const [selectedTool, setSelectedTool] = useState<ToolCall | null>(null);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  // Messages sent while the CLI is already running are queued by the
  // backend's per-topic EngineCmd channel. Track how many frontend sends are
  // waiting for an `exited` event so the UI doesn't briefly mark the Topic
  // idle between queued turns.
  const queuedTurnsByTopicRef = useRef<Record<string, number>>({});

  const incrementQueuedTurn = useCallback((topicId: string) => {
    queuedTurnsByTopicRef.current[topicId] = (queuedTurnsByTopicRef.current[topicId] || 0) + 1;
  }, []);

  const consumeQueuedTurn = useCallback((topicId: string): number => {
    const next = Math.max(0, (queuedTurnsByTopicRef.current[topicId] || 0) - 1);
    if (next === 0) delete queuedTurnsByTopicRef.current[topicId];
    else queuedTurnsByTopicRef.current[topicId] = next;
    return next;
  }, []);

  // handleStream is closed over in a mount-time listener (line ~470).
  // Reading `topics` directly from that closure would always give the
  // initial empty array — every notification then falls back to the
  // "Topic" placeholder instead of the real title. Mirror topics into
  // a ref the same way selectedIdRef is mirrored.
  const topicsRefForStream = useRef<Topic[]>([]);
  topicsRefForStream.current = topics;

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === selectedId) || null,
    [topics, selectedId]
  );

  // Initial load: detect CLIs and topics
  const refresh = useCallback(async () => {
    const det = await api.detectClis();
    setCliStatus(det.clis);
    const ts = await api.listTopics();
    setTopics(ts);
    const running = await api.runningTopics();
    setRunningIds(new Set(running));
    try {
      const eng = await api.getDefaultEngine();
      setDefaultEngine(eng);
    } catch {}
    try {
      const layout = await api.getChatLayout();
      if (layout === "inline" || layout === "thinking") setChatLayout(layout);
    } catch {}
    try {
      const mode = await api.getComposerSendMode();
      if (mode === "modEnter" || mode === "enter") setComposerSendMode(mode);
    } catch {}
    try {
      const snd = await api.getNotifySound();
      setNotifySoundEnabledState(snd);
      setNotifySoundEnabled(snd);
    } catch {}
    try {
      // v1.20: desktop shell preference. null = never set → platform default.
      // Once a user toggles it explicitly we stop second-guessing them.
      const dm = await api.getDesktopMode();
      const enabled = dm === null ? IS_LINUX : dm;
      setDesktopModeEnabledState(enabled);
      // Re-evaluate the initial view only if we haven't navigated yet.
      // selectedId being non-null means the user already opened a topic
      // (e.g. via deep link) — don't drag them back to the desktop.
      setTopView((cur) => {
        if (cur === "topic" || cur === "home" || cur === "desktop") {
          return enabled ? "desktop" : (cur === "desktop" ? "home" : cur);
        }
        return cur;
      });
    } catch {}
    return { clis: det.clis, topics: ts };
  }, []);

  // Desktop mode toggle handler (called from SettingsDialog).
  const onChangeDesktopMode = useCallback(async (enabled: boolean) => {
    setDesktopModeEnabledState(enabled);
    if (!enabled && topView === "desktop") setTopView("home");
    if (enabled && topView === "home") setTopView("desktop");
    try {
      await api.setDesktopMode(enabled);
    } catch (e) {
      api.debugLog(`setDesktopMode failed: ${e}`);
    }
  }, [topView]);

  const onChangeChatLayout = useCallback(async (layout: ChatLayout) => {
    setChatLayout(layout);
    try {
      await api.setChatLayout(layout);
    } catch (e) {
      api.debugLog(`set_chat_layout failed: ${e}`);
    }
  }, []);

  const onChangeDefaultEngine = useCallback(async (engine: string) => {
    setDefaultEngine(engine);
    try {
      await api.setDefaultEngine(engine);
    } catch (e) {
      api.debugLog(`set_default_engine failed: ${e}`);
    }
  }, []);

  const onChangeNotifySound = useCallback(async (enabled: boolean) => {
    setNotifySoundEnabledState(enabled);
    setNotifySoundEnabled(enabled);
    try {
      await api.setNotifySound(enabled);
    } catch (e) {
      api.debugLog(`set_notify_sound failed: ${e}`);
    }
  }, []);

  const onChangeComposerSendMode = useCallback(async (mode: ComposerSendMode) => {
    setComposerSendMode(mode);
    try {
      await api.setComposerSendMode(mode);
    } catch (e) {
      api.debugLog(`set_composer_send_mode failed: ${e}`);
    }
  }, []);

  useEffect(() => {
    refresh().then(({ clis, topics }) => {
      const ready = clis.some((c) => c.installed && c.loggedIn);
      if (ready && topics.length > 0) {
        setShowOnboarding(false);
      } else if (ready && topics.length === 0) {
        setShowOnboarding(false);
      } else {
        setShowOnboarding(true);
      }
    });
    // expose home for path shortening (~/foo display)
    api.getHomeDir()
      .then((h) => {
        (window as any).__SALMON_HOME__ = h || "";
      })
      .catch(() => {
        (window as any).__SALMON_HOME__ = "";
      });
  }, [refresh]);

  // Subscribe to stream events
  useEffect(() => {
    let un: UnlistenFn | undefined;
    api.debugLog("registering salmon-stream listener");
    listen<StreamEvent>("salmon-stream", (event) => {
      const k = (event.payload as any)?.kind;
      api.debugLog(`recv ${k} for topic=${(event.payload as any)?.topicId}`);
      handleStream(event.payload);
    })
      .then((u) => {
        un = u;
        api.debugLog("listener registered OK");
      })
      .catch((e) => api.debugLog(`listener register FAILED: ${e}`));
    return () => {
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStream = (e: StreamEvent) => {
    switch (e.kind) {
      case "started":
        setRunningIds((s) => new Set(s).add(e.topicId));
        setSpawningId((cur) => (cur === e.topicId ? null : cur));
        if (e.sessionId) {
          // could persist via topic refresh
        }
        break;
      case "thinking": {
        // Reasoning text from Claude's extended-thinking mode. Append as
        // a thinking block so the typing dots are accompanied by an
        // expanding 思考过程 section instead of going dark mid-turn.
        const now = Date.now();
        setMessagesByTopic((m) => {
          const list = [...(m[e.topicId] || [])];
          const pendingIdx = findLatestPendingAssistantIndex(list);
          let cur = pendingIdx >= 0 ? list[pendingIdx] : null;
          if (!cur) {
            cur = newAssistantMessage(e.messageId || cryptoId());
            list.push(cur);
          }
          const next: UiMessage = {
            ...cur,
            blocks: [
              ...cur.blocks,
              { kind: "thinking", content: e.content, createdAt: now },
            ],
          };
          if (pendingIdx >= 0) list[pendingIdx] = next;
          else list[list.length - 1] = next;
          return { ...m, [e.topicId]: list };
        });
        setBusyByTopic((b) => ({ ...b, [e.topicId]: true }));
        break;
      }
      case "assistantDone": {
        if (selectedIdRef.current === e.topicId) {
          markRead(e.topicId);
        }
        const now = Date.now();
        // Immutable update: never mutate the prior UiMessage in place. The
        // previous version of this code did `cur.blocks = ...`/`cur.content =
        // ...` directly on the list[length-1] reference, which was also live
        // in React's previous-state snapshot — any other code path holding
        // that same reference would observe the mutation. Replacing the
        // tail entry with a fresh object isolates the per-topic slot.
        setMessagesByTopic((m) => {
          const prev = m[e.topicId] || [];
          const pendingIdx = findLatestPendingAssistantIndex(prev);
          const pending = pendingIdx >= 0 ? prev[pendingIdx] : null;
          const newBlock: Block = { kind: "text", content: e.content, createdAt: now };
          const cur: UiMessage = pending
            ? {
                ...pending,
                blocks: [...pending.blocks, newBlock],
                content: (pending.content ? pending.content + "\n\n" : "") + e.content,
              }
            : {
                ...newAssistantMessage(e.messageId || cryptoId()),
                blocks: [newBlock],
                content: e.content,
              };
          const list = pending
            ? [...prev.slice(0, pendingIdx), cur, ...prev.slice(pendingIdx + 1)]
            : [...prev, cur];
          return { ...m, [e.topicId]: list };
        });
        // Mirror backend's touch_topic on assistant reply so the welcome
        // screen sees the latest activity timestamp.
        setTopics((cur) => cur.map((t) => (t.id === e.topicId ? { ...t, updatedAt: now } : t)));
        setBusyByTopic((b) => ({ ...b, [e.topicId]: true }));
        break;
      }
      case "usage": {
        // Per-turn token rollup from Claude's `result` / Codex's
        // `turn.completed`. Stamp the latest assistant message in memory
        // so the per-message footer can show "1.2k in · 340 out" right
        // away, then persist via a backend command so list_messages on a
        // future open returns the same numbers. Duration overrides the
        // wall-clock fallback computed by `exited` if the engine reported
        // its own (Claude does, Codex doesn't).
        setMessagesByTopic((m) => {
          const prev = m[e.topicId];
          if (!prev) return m;
          let lastIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === "assistant") { lastIdx = i; break; }
          }
          if (lastIdx === -1) return m;
          const target = prev[lastIdx];
          const updated: UiMessage = {
            ...target,
            tokenIn: (target.tokenIn || 0) + e.inputTokens,
            tokenOut: (target.tokenOut || 0) + e.outputTokens,
            durationMs: e.durationMs ?? target.durationMs,
          };
          const list = [...prev.slice(0, lastIdx), updated, ...prev.slice(lastIdx + 1)];
          return { ...m, [e.topicId]: list };
        });
        api.addTopicUsage(e.topicId, e.inputTokens, e.outputTokens)
          .then(() => refreshUsageSummary())
          .catch((err) => api.debugLog(`addTopicUsage failed: ${err}`));
        if (e.durationMs !== null && e.durationMs > 0) {
          api.setTopicTurnDuration(e.topicId, e.durationMs).catch((err) => {
            api.debugLog(`setTopicTurnDuration (from usage) failed: ${err}`);
          });
        }
        break;
      }
      case "toolCall": {
        setMessagesByTopic((m) => {
          const prev = m[e.topicId] || [];
          const pendingIdx = findLatestPendingAssistantIndex(prev);
          const pending = pendingIdx >= 0 ? prev[pendingIdx] : null;
          const newBlock: Block = { kind: "tool", tool: e.tool, createdAt: Date.now() };
          const cur: UiMessage = pending
            ? {
                ...pending,
                blocks: [...pending.blocks, newBlock],
                tools: [...pending.tools, e.tool],
              }
            : {
                ...newAssistantMessage(cryptoId()),
                blocks: [newBlock],
                tools: [e.tool],
              };
          const list = pending
            ? [...prev.slice(0, pendingIdx), cur, ...prev.slice(pendingIdx + 1)]
            : [...prev, cur];
          return { ...m, [e.topicId]: list };
        });
        break;
      }
      case "toolResult": {
        setMessagesByTopic((m) => {
          const prev = m[e.topicId] || [];
          let dirty = false;
          const list = prev.map((msg) => {
            const tools = msg.tools.map((t) => {
              if (t.id === e.toolId) {
                dirty = true;
                return { ...t, state: (e.state as any) || "done", result: e.result || null };
              }
              return t;
            });
            const blocks = msg.blocks.map((b) =>
              b.kind === "tool" && b.tool.id === e.toolId
                ? {
                    ...b,
                    tool: {
                      ...b.tool,
                      state: (e.state as any) || "done",
                      result: e.result || null,
                    },
                  }
                : b
            );
            return tools === msg.tools && blocks === msg.blocks
              ? msg
              : { ...msg, tools, blocks };
          });
          return dirty ? { ...m, [e.topicId]: list } : m;
        });
        setFilesRefreshKey((k) => k + 1);
        break;
      }
      case "permissionRequest": {
        setPendingPermByTopic((p) => ({
          ...p,
          [e.topicId]: { id: e.requestId, tool: e.tool, input: e.input, command: e.command },
        }));
        const topic = topicsRefForStream.current.find((t) => t.id === e.topicId);
        const detail = e.tool === "Bash" && e.command
          ? `Bash: ${truncate(e.command, 80)}`
          : `工具: ${e.tool}`;
        fireNotify({
          topicId: e.topicId,
          kind: "permission",
          title: `${topic?.title || "Topic"} · 需要授权`,
          body: detail,
        });
        break;
      }
      case "error": {
        setErrorByTopic((er) => ({ ...er, [e.topicId]: e.message }));
        setBusyByTopic((b) => ({ ...b, [e.topicId]: (queuedTurnsByTopicRef.current[e.topicId] || 0) > 0 }));
        const topic = topicsRefForStream.current.find((t) => t.id === e.topicId);
        fireNotify({
          topicId: e.topicId,
          kind: "error",
          title: `${topic?.title || "Topic"} · 错误`,
          body: truncate(e.message, 100),
        });
        break;
      }
      case "exited": {
        const queuedAfterThisTurn = consumeQueuedTurn(e.topicId);
        setBusyByTopic((b) => ({ ...b, [e.topicId]: queuedAfterThisTurn > 0 }));
        const exitedAt = Date.now();
        // Mark current pending assistant as done, AND sweep any tool calls
        // still in `running`. The CLI subprocess can die mid tool-call (e.g.
        // a Bash that pkill's its own parent), in which case the matching
        // tool_result line never reaches us and the card would otherwise
        // hang on "running" forever. Also stamp wall-clock duration onto
        // the most recent assistant message: from the most recent user
        // message's createdAt → exitedAt.
        let durationMs: number | null = null;
        setMessagesByTopic((m) => {
          const prev = m[e.topicId];
          if (!prev) return m;
          let latestAssistantIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === "assistant") { latestAssistantIdx = i; break; }
          }
          let lastUserAt: number | null = null;
          for (let i = (latestAssistantIdx >= 0 ? latestAssistantIdx - 1 : prev.length - 1); i >= 0; i--) {
            if (prev[i].role === "user") { lastUserAt = prev[i].createdAt; break; }
          }
          if (lastUserAt !== null) durationMs = exitedAt - lastUserAt;
          let dirty = false;
          const list = prev.map((msg, idx) => {
            const pending =
              msg.role === "assistant" && msg.pending ? false : msg.pending;
            if (pending !== msg.pending) dirty = true;
            const tools = msg.tools.map((t) => {
              if (t.state === "running") {
                dirty = true;
                return {
                  ...t,
                  state: "error" as const,
                  result: t.result || "engine 进程已退出，工具调用未完成",
                };
              }
              return t;
            });
            const blocks = msg.blocks.map((b) =>
              b.kind === "tool" && b.tool.state === "running"
                ? {
                    ...b,
                    tool: {
                      ...b.tool,
                      state: "error" as const,
                      result: b.tool.result || "engine 进程已退出，工具调用未完成",
                    },
                  }
                : b
            );
            const stampDuration =
              idx === latestAssistantIdx && durationMs !== null && durationMs > 0
                ? durationMs
                : msg.durationMs;
            if (stampDuration !== msg.durationMs) dirty = true;
            return pending === msg.pending && tools === msg.tools && blocks === msg.blocks && stampDuration === msg.durationMs
              ? msg
              : { ...msg, pending, tools, blocks, durationMs: stampDuration };
          });
          return dirty ? { ...m, [e.topicId]: list } : m;
        });
        // Persist the duration so list_messages on next load returns it.
        // Backend resolves "latest assistant in topic" itself; we don't
        // need to track DB ids in the frontend.
        if (durationMs !== null && durationMs > 0) {
          api.setTopicTurnDuration(e.topicId, durationMs).catch((err) => {
            api.debugLog(`setTopicTurnDuration failed: ${err}`);
          });
        }
        // Distinguish clean exit from crash. null/0 = success per Unix
        // convention; engine drivers signal interruption with non-zero.
        const topic = topicsRefForStream.current.find((t) => t.id === e.topicId);
        const ok = e.code === null || e.code === 0;
        if (queuedAfterThisTurn === 0) {
          fireNotify({
            topicId: e.topicId,
            kind: ok ? "done" : "crash",
            title: ok
              ? `${topic?.title || "Topic"} · 完成`
              : `${topic?.title || "Topic"} · 异常退出 (code ${e.code})`,
            body: ok ? "Agent 已交还控制权" : "Engine 进程异常结束,未必是任务失败",
          });
        }
        setFilesRefreshKey((k) => k + 1);
        maybeAutoTitle(e.topicId);
        break;
      }
      case "sessionEnded":
        // The whole driver task ended (channel closed, panic, shutdown).
        // Drop the topic from `runningIds` so the next onSelect re-spawns;
        // also clear busy in case an Exited event got swallowed.
        setRunningIds((s) => {
          if (!s.has(e.topicId)) return s;
          const next = new Set(s);
          next.delete(e.topicId);
          return next;
        });
        setBusyByTopic((b) => ({ ...b, [e.topicId]: false }));
        setPendingPermByTopic((p) => ({ ...p, [e.topicId]: null }));
        // Safety net: same orphan-tool-call sweep as `exited`. Normally
        // exited fires first and clears these, but if the driver task
        // panicked mid-prompt only sessionEnded reaches us.
        setMessagesByTopic((m) => {
          const list = m[e.topicId];
          if (!list) return m;
          let dirty = false;
          const next = list.map((msg) => {
            const tools = msg.tools.map((t) => {
              if (t.state === "running") {
                dirty = true;
                return { ...t, state: "error" as const, result: t.result || "engine 会话已结束，工具调用未完成" };
              }
              return t;
            });
            const blocks = msg.blocks.map((b) =>
              b.kind === "tool" && b.tool.state === "running"
                ? {
                    ...b,
                    tool: {
                      ...b.tool,
                      state: "error" as const,
                      result: b.tool.result || "engine 会话已结束，工具调用未完成",
                    },
                  }
                : b
            );
            const pending = msg.role === "assistant" && msg.pending ? false : msg.pending;
            if (pending !== msg.pending) dirty = true;
            return { ...msg, tools, blocks, pending };
          });
          return dirty ? { ...m, [e.topicId]: next } : m;
        });
        break;
      case "log":
        setLogsByTopic((lg) => {
          const arr = [...(lg[e.topicId] || []), e.line];
          return { ...lg, [e.topicId]: arr.slice(-1000) };
        });
        break;
      default:
        break;
    }
  };

  const titleAttemptedRef = useRef<Set<string>>(new Set());
  const maybeAutoTitle = (topicId: string) => {
    if (titleAttemptedRef.current.has(topicId)) return;
    setTopics((cur) => {
      const t = cur.find((x) => x.id === topicId);
      if (!t) return cur;
      const isDefault = t.title === "新建 Topic" || t.title.trim() === "";
      if (!isDefault) return cur;
      titleAttemptedRef.current.add(topicId);
      api
        .suggestTopicTitle(topicId)
        .then((newTitle) => {
          setTopics((cs) => cs.map((x) => (x.id === topicId ? { ...x, title: newTitle } : x)));
        })
        .catch((e) => {
          api.debugLog(`auto-title failed for ${topicId}: ${e}`);
        });
      return cur;
    });
  };


  const onSelect = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setSelectedTool(null);
      markRead(id);
      // Check workdir up front so we can show a proper banner instead of
      // letting the CLI fail with a cryptic exit code on first send.
      const t = topics.find((x) => x.id === id);
      if (t) {
        try {
          const chk = await api.checkWorkdir(t.workdir);
          setWorkdirOkByTopic((m) => ({ ...m, [id]: chk.exists && chk.isDir }));
        } catch {
          setWorkdirOkByTopic((m) => ({ ...m, [id]: false }));
        }
      }
      if (!messagesByTopic[id]) {
        try {
          const msgs = await api.listMessages(id);
          setMessagesByTopic((m) => ({ ...m, [id]: hydrate(msgs) }));
        } catch {}
      }
      if (!runningIds.has(id)) {
        setSpawningId(id);
        try {
          await api.openTopic(id);
        } catch (e: any) {
          setErrorByTopic((er) => ({ ...er, [id]: String(e) }));
          setSpawningId(null);
        }
      }
    },
    [messagesByTopic, runningIds, topics]
  );

  const navigateActionTarget = useCallback((target: ToastActionTarget) => {
    if (target.view === "topic") {
      setTopView("topic");
      onSelect(target.topicId);
      return;
    }
    setSelectedId(null);
    setSelectedTool(null);
    if (target.view === "calendar") {
      setTopView("calendar");
      setPendingOpenCalendar({
        eventId: target.eventId ?? null,
        accountId: target.accountId ?? null,
        startMs: target.startMs ?? null,
      });
      return;
    }
    if (target.view === "tasks") {
      setTopView("tasks");
      setPendingOpenTask({
        taskId: target.taskId ?? null,
        accountId: target.accountId ?? null,
      });
      return;
    }
    if (target.view === "mail") {
      setTopView("mail");
      setPendingOpenMail({
        messageId: target.messageId ?? null,
        accountId: target.accountId ?? null,
      });
    }
  }, [onSelect]);

  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail as ToastActionTarget | undefined;
      if (!target?.view) return;
      navigateActionTarget(target);
    };
    window.addEventListener("salmon:navigate", handler);
    return () => window.removeEventListener("salmon:navigate", handler);
  }, [navigateActionTarget]);

  const onArchive = useCallback(async (id: string, archived: boolean) => {
    try {
      await api.setArchived(id, archived);
      setTopics((cur) =>
        cur.map((t) => (t.id === id ? { ...t, archived } : t))
      );
      if (archived && selectedIdRef.current === id) {
        setSelectedId(null);
      }
    } catch (e: any) {
      api.debugLog(`set_archived failed: ${e}`);
    }
  }, []);

  const openSearch = useCallback((query = "") => {
    setSearchInitialQuery(query);
    setShowSearch(true);
  }, []);

  // v1.16.0: Cmd/Ctrl+Shift+F opens the global SearchDialog. Cmd+F alone
  // remains the Topic-internal search shortcut handled inside ChatStream,
  // so the two scopes have distinct keys to match the distinct buttons.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [openSearch]);

  const onRetryTopic = useCallback(async (id: string) => {
    setErrorByTopic((er) => ({ ...er, [id]: null }));
    setSpawningId(id);
    try {
      await api.openTopic(id);
      setRunningIds((s) => new Set(s).add(id));
    } catch (e: any) {
      setErrorByTopic((er) => ({ ...er, [id]: String(e) }));
    } finally {
      setSpawningId((cur) => (cur === id ? null : cur));
    }
  }, []);

  // Recovery from a corrupt CLI session (typical trigger: the
  // `diagnostics.previous_message_id` 400 after a mid-stream socket drop).
  // Drops the cached session_id + kills the running subprocess in the
  // backend, then re-spawns without --resume. Topic messages are kept.
  const onResetSession = useCallback(async (id: string) => {
    setErrorByTopic((er) => ({ ...er, [id]: null }));
    setSpawningId(id);
    try {
      await api.resetTopicSession(id);
      setRunningIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      await api.openTopic(id);
      setRunningIds((s) => new Set(s).add(id));
    } catch (e: any) {
      setErrorByTopic((er) => ({ ...er, [id]: String(e) }));
    } finally {
      setSpawningId((cur) => (cur === id ? null : cur));
    }
  }, []);

  // Single dispatch point for every "the user might want to know" event.
  // Suppresses a notification when the user is already looking at the
  // relevant context: a topic-tied event whose topicId matches the open
  // topic, or a recs roundup while sitting on the welcome screen.
  const fireNotify = useCallback((opts: NotifyOpts) => {
    const here = selectedIdRef.current;
    if (opts.topicId !== null && here === opts.topicId) return;
    if (opts.topicId === null && here === null) return;
    void notify(opts, windowFocusedRef.current, pushToast);
  }, [pushToast]);

  const onToastClick = useCallback((t: ToastEvent) => {
    // Setting selectedId alone bypasses everything onSelect does:
    // markRead, workdir validity check, lazy engine.spawn, message
    // hydration. Click-to-open from a toast or system notification
    // landed users on a Topic that looked empty / didn't auto-resume.
    if (t.topicId) {
      onSelect(t.topicId);
    } else if (t.actions?.[0]) {
      navigateActionTarget(t.actions[0].target);
    } else {
      setSelectedId(null);
      setSelectedTool(null);
    }
  }, [navigateActionTarget, onSelect]);

  const onToggleDangerMode = useCallback(async (id: string, danger: boolean) => {
    try {
      // Backend kills the running CLI session inside set_danger_mode (the
      // --dangerously-skip-permissions flag is launch-time, can't change
      // mid-process). Re-open immediately so the engine respawns with the
      // new flag — Claude Code / Codex resume by --resume <session_id>, so
      // the conversation context is preserved.
      await api.setDangerMode(id, danger);
      try {
        await api.openTopic(id);
      } catch (e: any) {
        api.debugLog(`re-open after danger toggle failed for ${id}: ${e}`);
      }
      setTopics((cur) =>
        cur.map((t) => (t.id === id ? { ...t, dangerMode: danger } : t))
      );
      setDangerHintTopicId(id);
      window.setTimeout(() => {
        setDangerHintTopicId((cur) => (cur === id ? null : cur));
      }, 4000);
    } catch (e: any) {
      api.debugLog(`set_danger_mode failed: ${e}`);
    }
  }, []);

  const onCreateTopic = useCallback(
    async (args: {
      title: string;
      engine: string;
      workdir: string;
      model: string | null;
      dangerMode: boolean;
    }) => {
      const t = await api.createTopic(args);
      setTopics((cur) => [t, ...cur.filter((x) => x.id !== t.id)]);
      // New-topic selection must not depend on onSelect's closed-over topic
      // list: React has not committed setTopics yet, so the just-created
      // topic may be invisible to that callback. Seed every per-topic slot
      // here to guarantee the first selected render is isolated.
      setMessagesByTopic((m) => ({ ...m, [t.id]: [] }));
      setLogsByTopic((m) => ({ ...m, [t.id]: [] }));
      setBusyByTopic((m) => ({ ...m, [t.id]: false }));
      setPendingPermByTopic((m) => ({ ...m, [t.id]: null }));
      setErrorByTopic((m) => ({ ...m, [t.id]: null }));
      setWorkdirOkByTopic((m) => ({ ...m, [t.id]: true }));
      setSelectedTool(null);
      setSelectedId(t.id);
      markRead(t.id);
      setShowNew(false);
      try {
        const chk = await api.checkWorkdir(t.workdir);
        setWorkdirOkByTopic((m) => ({ ...m, [t.id]: chk.exists && chk.isDir }));
      } catch {
        setWorkdirOkByTopic((m) => ({ ...m, [t.id]: false }));
      }
      setSpawningId(t.id);
      try {
        await api.openTopic(t.id);
      } catch (e: any) {
        setErrorByTopic((er) => ({ ...er, [t.id]: String(e) }));
        setSpawningId(null);
      }
    },
    [markRead]
  );

  /** v1.17.0: "+ 新建" quick-path — no dialog, scratch workdir,
   *  immediately focused. Routes through the same selection/init
   *  scaffolding as the dialog flow. */
  const onQuickNewTopic = useCallback(async () => {
    let t: Topic;
    try {
      t = await api.createQuickTopic({});
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: "新建 Topic 失败", body: String(e), kind: "error" },
      }));
      return;
    }
    setTopics((cur) => [t, ...cur.filter((x) => x.id !== t.id)]);
    setMessagesByTopic((m) => ({ ...m, [t.id]: [] }));
    setLogsByTopic((m) => ({ ...m, [t.id]: [] }));
    setBusyByTopic((m) => ({ ...m, [t.id]: false }));
    setPendingPermByTopic((m) => ({ ...m, [t.id]: null }));
    setErrorByTopic((m) => ({ ...m, [t.id]: null }));
    setWorkdirOkByTopic((m) => ({ ...m, [t.id]: true }));
    setSelectedTool(null);
    setSelectedId(t.id);
    setTopView("topic");
    markRead(t.id);
    setSpawningId(t.id);
    try {
      await api.openTopic(t.id);
    } catch (e: any) {
      setErrorByTopic((er) => ({ ...er, [t.id]: String(e) }));
      setSpawningId(null);
    }
    return t;
  }, [markRead]);

  // v1.17.0: Cmd/Ctrl+N opens the quick path; Cmd/Ctrl+Shift+N opens the
  // dialog. Pattern intentionally mirrors the Cmd+F / Cmd+Shift+F split
  // we landed in v1.16.0 for search scopes.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "n") return;
      e.preventDefault();
      if (e.shiftKey) {
        setShowNew(true);
      } else {
        void onQuickNewTopic();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onQuickNewTopic]);

  // v1.17.0: derive the current global-AI context from topView + any
  // selection state lifted up via onContextChange. Other views (cal,
  // tasks, contacts, briefing) report just their kind for now — the
  // agent can salmon-query for specifics if it needs them.
  const currentAIContext: GlobalAIContext = useMemo(() => {
    if (selectedTopic) {
      return { kind: "topic", topicId: selectedTopic.id, topicTitle: selectedTopic.title };
    }
    if (topView === "mail") {
      const c = mailContext;
      return {
        kind: "mail",
        view: c?.messageId ? "detail" : "list",
        accountId: c?.accountId ?? null,
        messageId: c?.messageId ?? null,
        threadId: c?.threadId ?? null,
        subject: c?.subject ?? null,
        fromEmail: c?.fromEmail ?? null,
        fromName: c?.fromName ?? null,
      };
    }
    if (topView === "calendar") return { kind: "calendar" };
    if (topView === "tasks") return { kind: "tasks", filter: "pending" };
    if (topView === "contacts") return { kind: "contacts" };
    if (topView === "home") return { kind: "briefing" };
    return { kind: "home" };
  }, [topView, selectedTopic, mailContext]);

  // onAISubmit is declared further down, AFTER sendToTopic (which it
  // calls). Placed there to avoid the temporal-dead-zone reference
  // error of consuming a useCallback'd const before its initialiser.


  const sendToTopic = useCallback(
    async (topicId: string, text: string) => {
      const now = Date.now();
      const optimisticId = cryptoId();
      setMessagesByTopic((m) => {
        const list = [...(m[topicId] || [])];
        list.push({
          id: optimisticId,
          role: "user",
          content: text,
          blocks: [{ kind: "text", content: text, createdAt: now }],
          tools: [],
          createdAt: now,
        });
        return { ...m, [topicId]: list };
      });
      // Mirror backend's touch_topic so the welcome screen reorders this topic
      // to the top right away — without this, the user-visible list keeps the
      // ordering from app launch until a full topic refetch.
      setTopics((cur) => cur.map((t) => (t.id === topicId ? { ...t, updatedAt: now } : t)));
      setBusyByTopic((b) => ({ ...b, [topicId]: true }));
      setErrorByTopic((er) => ({ ...er, [topicId]: null }));
      incrementQueuedTurn(topicId);
      try {
        await api.sendMessage(topicId, text);
      } catch (e: any) {
        const remaining = consumeQueuedTurn(topicId);
        setMessagesByTopic((m) => ({
          ...m,
          [topicId]: (m[topicId] || []).filter((msg) => msg.id !== optimisticId),
        }));
        setErrorByTopic((er) => ({ ...er, [topicId]: String(e) }));
        setBusyByTopic((b) => ({ ...b, [topicId]: remaining > 0 }));
      }
    },
    [consumeQueuedTurn, incrementQueuedTurn]
  );

  /** v1.17.0: ⌘K AI button onSubmit handler. Creates a scratch Topic →
   *  drops a context-seed system message in → sends the user's text
   *  as the first user message → navigates. Returns the new topic id
   *  so the GlobalAIButton can dismiss its popover. */
  const onAISubmit = useCallback(async (userText: string, ctx: GlobalAIContext): Promise<string | null> => {
    let t: Topic;
    try {
      t = await api.createQuickTopic({ title: deriveAITopicTitle(userText) });
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent("salmon:toast", {
        detail: { title: "AI 新建 Topic 失败", body: String(e), kind: "error" },
      }));
      return null;
    }
    setTopics((cur) => [t, ...cur.filter((x) => x.id !== t.id)]);
    setMessagesByTopic((m) => ({ ...m, [t.id]: [] }));
    setLogsByTopic((m) => ({ ...m, [t.id]: [] }));
    setBusyByTopic((m) => ({ ...m, [t.id]: false }));
    setPendingPermByTopic((m) => ({ ...m, [t.id]: null }));
    setErrorByTopic((m) => ({ ...m, [t.id]: null }));
    setWorkdirOkByTopic((m) => ({ ...m, [t.id]: true }));

    const seed = formatAIContextSeed(ctx);
    if (seed) {
      try {
        await api.appendSystemMessage(t.id, seed);
      } catch (e: any) {
        api.debugLog(`appendSystemMessage failed: ${e}`);
      }
    }

    setSelectedTool(null);
    setSelectedId(t.id);
    setTopView("topic");
    markRead(t.id);

    setSpawningId(t.id);
    try {
      await api.openTopic(t.id);
    } catch (e: any) {
      setErrorByTopic((er) => ({ ...er, [t.id]: String(e) }));
      setSpawningId(null);
      return t.id;
    }
    try {
      await sendToTopic(t.id, userText);
    } catch (e: any) {
      api.debugLog(`AI initial send failed: ${e}`);
    }
    return t.id;
  }, [markRead, sendToTopic]);

  const continueWithLocalContext = useCallback(
    async (topicId: string, content: string) => {
      setBusyByTopic((b) => ({ ...b, [topicId]: true }));
      setErrorByTopic((er) => ({ ...er, [topicId]: null }));
      incrementQueuedTurn(topicId);
      try {
        const saved = await api.continueWithLocalContext(topicId, content);
        const ui = hydrate([saved])[0];
        setMessagesByTopic((m) => {
          const list = m[topicId] || [];
          if (list.some((msg) => msg.id === ui.id)) return m;
          return { ...m, [topicId]: [...list, ui] };
        });
      } catch (e: any) {
        const remaining = consumeQueuedTurn(topicId);
        setErrorByTopic((er) => ({ ...er, [topicId]: String(e) }));
        setBusyByTopic((b) => ({ ...b, [topicId]: remaining > 0 }));
      }
    },
    [consumeQueuedTurn, incrementQueuedTurn]
  );

  useEffect(() => {
    const onLocalContext = (event: Event) => {
      const detail = (event as CustomEvent<{ topicId?: string; content?: string }>).detail;
      if (!detail?.topicId || !detail.content) return;
      void continueWithLocalContext(detail.topicId, detail.content);
    };
    window.addEventListener("salmon:local-context", onLocalContext);
    return () => window.removeEventListener("salmon:local-context", onLocalContext);
  }, [continueWithLocalContext]);

  useEffect(() => {
    const onAnticipate = (event: Event) => {
      const detail = (event as CustomEvent<{ topicId?: string; delta?: number }>).detail;
      if (!detail?.topicId || typeof detail.delta !== "number") return;
      setAnticipatingByTopic((m) => {
        const cur = m[detail.topicId!] || 0;
        const next = Math.max(0, cur + detail.delta!);
        return { ...m, [detail.topicId!]: next };
      });
    };
    window.addEventListener("salmon:anticipate-engine", onAnticipate);
    return () => window.removeEventListener("salmon:anticipate-engine", onAnticipate);
  }, []);

  const onSend = useCallback(
    async (text: string) => {
      if (!selectedId) return;
      await sendToTopic(selectedId, text);
    },
    [selectedId, sendToTopic]
  );

  // Click "同意" on a recommendation → jump to its Topic AND auto-send a
  // structured prompt built from the rec's title + rationale + payoff +
  // action_hint, so the assistant gets the full brief the user just read on
  // the card. Previously only action_hint was sent (≤60 chars after
  // truncate_chars(60), bounded by the prompt template's ≤40 字 instruction)
  // — the agent then had to pattern-match a one-liner with no context.
  const onAcceptRec = useCallback(
    async (rec: Recommendation) => {
      onDecideRec(rec.id, "accepted");
      if (!rec.topicId) return;
      const text = buildAcceptPrompt(rec);
      if (!text) return;
      await onSelect(rec.topicId);
      await sendToTopic(rec.topicId, text);
    },
    [onDecideRec, onSelect, sendToTopic]
  );

  const onInterrupt = useCallback(async () => {
    if (!selectedId) return;
    await api.interruptTopic(selectedId);
  }, [selectedId]);

  const onApprove = useCallback(
    async (requestId: string, allow: boolean) => {
      if (!selectedId) return;
      await api.approvePermission(selectedId, requestId, allow);
      setPendingPermByTopic((p) => ({ ...p, [selectedId]: null }));
    },
    [selectedId]
  );

  const onDelete = useCallback(async (id: string) => {
    await api.deleteTopic(id);
    setTopics((cur) => cur.filter((t) => t.id !== id));
    if (selectedIdRef.current === id) setSelectedId(null);
  }, []);

  const onRename = useCallback(async (id: string, title: string) => {
    await api.renameTopic(id, title);
    setTopics((cur) => cur.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  // Quit confirmation when running topics exist. The browser-level
  // `beforeunload` event is unreliable in WKWebView (macOS) — the dialog
  // string is ignored and preventDefault doesn't actually block the
  // close. Tauri 2's `onCloseRequested` is the cross-platform answer:
  // it can asynchronously prevent the close via `event.preventDefault()`,
  // letting us pop a real native ask() dialog. Mirrors runningIds into a
  // ref so the close handler — subscribed once — always sees the latest
  // count without re-subscribing on every Set change.
  const runningIdsRef = useRef<Set<string>>(runningIds);
  const forceQuitRef = useRef(false);
  runningIdsRef.current = runningIds;
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const win = getCurrentWindow();
        const fn = await win.onCloseRequested(async (event) => {
          if (forceQuitRef.current) return;
          const n = runningIdsRef.current.size;
          if (n === 0) return; // No running topics — let Tauri close normally.
          // v1.1.3: must call preventDefault synchronously. Tauri 2's
          // onCloseRequested doesn't await the handler before deciding to
          // close — by the time `await ask(...)` resolves the close
          // request has already been processed (or dropped under WKWebView),
          // so calling preventDefault after the await was a no-op. That's
          // why "Yes" in the dialog didn't actually quit in v1.1.2.
          // Fix: always preventDefault first; on confirm, explicitly
          // destroy() the window.
          event.preventDefault();
          const ok = await ask(`还有 ${n} 个 Topic 在运行,确定退出?未完成的对话会被中断。`, {
            title: "确认退出 SalmonApp",
            kind: "warning",
          });
          if (ok) {
            forceQuitRef.current = true;
            try {
              await api.quitApp();
            } catch {
              try { await win.destroy(); } catch { /* already gone */ }
            }
          }
        });
        if (cancelled) fn();
        else unlisten = fn;
      } catch {
        // Browser / dev preview (no Tauri window). beforeunload still
        // fires there; keep a minimal fallback for that case.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const selectedMessages = selectedTopic ? messagesByTopic[selectedTopic.id] || [] : [];

  // Onboarding view
  if (showOnboarding) {
    return (
      <Onboarding
        cliStatus={cliStatus}
        onRefresh={refresh}
        onContinue={() => {
          setShowOnboarding(false);
          setShowNew(true);
        }}
      />
    );
  }

  // v0.11.1: badge counts maintained in state; refreshed on mount and
  // on relevant events (mail-sync done, briefing done, etc).
  const briefBadgeCount = recommendations.filter((r) => r.status === "pending").length;

  // v1.20: Ubuntu Desktop shell takes over the IconRail+middle layout when
  // active. We render <DesktopView/> in place of the normal panels but
  // keep modals (Settings / Search / Toasts) at the outer scope so they
  // still work from inside the desktop. Conditioned on (a) the user
  // selected the desktop view AND (b) no topic is currently open AND (c)
  // they haven't disabled it in Settings.
  // v1.20.2: Desktop shell is Linux-only — a non-Linux user with a stale
  // `desktop_mode = 1` in their DB (from earlier versions where the toggle
  // was visible everywhere) should still land on WelcomeBack. The setting
  // can stay in DB; we just don't honour it off Linux.
  const desktopActive =
    !isAppWindow && IS_LINUX && topView === "desktop" && !selectedTopic && desktopModeEnabled;

  // v0.11: layout columns are IconRail(56) + [LeftSidebar(260)] + middle(1fr) + [RightPane(380)].
  // LeftSidebar only renders for topic view; RightPane only when a topic is selected.
  // Modifier classes drive grid-template-columns in styles.css.
  // Phase 3 multi-window: per-app windows (isAppWindow) hide the IconRail —
  // they're focused single-purpose windows; users switch apps via the dock
  // on the desktop shell.
  const hasLeftSidebar = !isAppWindow && (topView === "topic" || !!selectedTopic);
  const layoutClasses = ["app", "v11"];
  if (!hasLeftSidebar) layoutClasses.push("no-left");
  if (!selectedTopic) layoutClasses.push("no-right");
  else if (rightCollapsed) layoutClasses.push("right-collapsed");
  if (isAppWindow) layoutClasses.push("app-window");
  // Per-app windows (Mail / Calendar / ... spawned by the Desktop shell)
  // each get a slim in-app titlebar — the compositor doesn't always draw
  // close/minimize for webkit2gtk windows under labwc/GNOME Wayland, so
  // we ship our own buttons that drive the window plugin directly.
  const appWindowTitle =
    initialHashView === "mail" ? "Salmon Mail" :
    initialHashView === "calendar" ? "Salmon Calendar" :
    initialHashView === "tasks" ? "Salmon Tasks" :
    initialHashView === "contacts" ? "Salmon Contacts" :
    initialHashView === "home" ? "SalmonApp" :
    initialHashView === "settings" ? "Salmon Settings" :
    "SalmonApp";

  return (
    <div className={desktopActive ? "app desktop-mode" : layoutClasses.join(" ")}>
      {isAppWindow && <AppWindowTitleBar title={appWindowTitle} />}
      {desktopActive ? (
        <DesktopView
          onExitDesktop={() => setTopView("home")}
          onNavigateHome={() => setTopView("home")}
          onNavigateMail={() => setTopView("mail")}
          onNavigateCalendar={() => setTopView("calendar")}
          onNavigateTasks={() => setTopView("tasks")}
          onNavigateContacts={() => setTopView("contacts")}
          onNewTopic={() => setShowNew(true)}
          onOpenSearch={(q) => openSearch(q)}
          onOpenSettings={() => { setShowSettings(true); refreshUsageSummary(); }}
        />
      ) : (<>
      {!isAppWindow && <IconRail
        view={(selectedTopic ? "topic" : topView) as any}
        unreadMail={unreadMailBadge}
        pendingTasks={pendingTasksBadge}
        briefCount={briefBadgeCount}
        cliStatus={cliStatus}
        onView={(v) => {
          if (v === "topic") {
            // Stay on whatever topic is currently selected; if none, switch
            // to topic view shell — user picks from the topic list pane.
            setTopView("topic");
            return;
          }
          setSelectedId(null);
          setSelectedTool(null);
          // v1.20: when Ubuntu Desktop shell is enabled, "home" is the
          // desktop — the IconRail home button doubles as "back to desktop".
          // Settings has a toggle for users who'd rather see WelcomeBack.
          // v1.20.2: home → desktop redirect is Linux-only.
          if (v === "home" && desktopModeEnabled && IS_LINUX) {
            setTopView("desktop");
          } else {
            setTopView(v);
          }
          if (v === "home") refreshUsageSummary();
        }}
        onOpenSearch={() => openSearch()}
        onOpenSettings={() => { setShowSettings(true); refreshUsageSummary(); }}
      />}

      {/* Topic view: show LeftSidebar (topic list) + chat + RightPane. */}
      {topView === "topic" || selectedTopic ? (
        <LeftSidebar
          topics={topics}
          selectedId={selectedId}
          runningIds={runningIds}
          spawningId={spawningId}
          cliStatus={cliStatus}
          onSelect={(id) => { setTopView("topic"); onSelect(id); }}
          onQuickNewTopic={onQuickNewTopic}
          onNewTopic={() => setShowNew(true)}
          onOpenSearch={openSearch}
          onDeleteTopic={onDelete}
          onRequestRenameTopic={(id) => setRenamingTopicId(id)}
          onArchiveTopic={onArchive}
        />
      ) : null}

      {!selectedTopic ? (
        <>
          <section className="middle">
            {topView === "mail" ? (
              <MailView
                pendingComposeReply={pendingComposeReply}
                onConsumeComposeReply={() => setPendingComposeReply(null)}
                pendingOpenMail={pendingOpenMail}
                onConsumePendingOpenMail={() => setPendingOpenMail(null)}
                onContextChange={setMailContext}
              />
            ) : topView === "contacts" ? (
              <ContactsView />
            ) : topView === "calendar" ? (
              <CalendarView
                pendingOpenEvent={pendingOpenCalendar}
                onConsumePendingOpenEvent={() => setPendingOpenCalendar(null)}
              />
            ) : topView === "tasks" ? (
              <TasksView
                pendingOpenTask={pendingOpenTask}
                onConsumePendingOpenTask={() => setPendingOpenTask(null)}
              />
            ) : topView === "topic" ? (
              <div className="empty-feature">
                <div className="empty-icon">💬</div>
                <div className="empty-title">选一个 Topic 或新建一个</div>
                <div className="empty-sub">左侧列表里的 Topic 点开即可进入对话。</div>
              </div>
            ) : (
              <WelcomeBack
                topics={topics}
                lastReadAt={lastReadAt}
                pendingPermByTopic={pendingPermByTopic}
                errorByTopic={errorByTopic}
                workdirOkByTopic={workdirOkByTopic}
                runningIds={runningIds}
                recommendations={recommendations}
                recsLoading={recsLoading}
                recsError={recsError}
                onRefreshRecs={generateRecs}
                onDecideRec={onDecideRec}
                onAcceptRec={onAcceptRec}
                onSelect={onSelect}
                onNewTopic={() => setShowNew(true)}
                usageSummary={usageSummary}
                briefingRunning={briefingRunning}
                briefingProgress={briefingProgress}
                briefingTick={briefingTick}
                onRunBriefing={runBriefing}
                unreadMail={unreadMailBadge}
              />
            )}
          </section>
        </>
      ) : (
        <>
          <section className="middle">
            <div className="mid-head">
              {/* v1.19.0: title cluster — engine pill + title +
                  (scratch pill | breadcrumb short path with full path
                  tooltip). Scratch topics no longer expose the ugly
                  app_data_dir path; non-scratch shows ~/foo as a hint. */}
              <div className="title-cluster">
                <span className={`engine-pill ${selectedTopic.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                  {selectedTopic.engine === "claude" ? "CC" : "CX"}
                </span>
                <span className="title" onDoubleClick={() => setRenamingTopicId(selectedTopic.id)}>
                  {selectedTopic.title}
                </span>
                {selectedTopic.isScratch ? (
                  <span className="scratch-pill" title="暂存 Topic — 工作目录由 SalmonApp 管理">暂存</span>
                ) : selectedTopic.workdir ? (
                  <span className="breadcrumb" title={selectedTopic.workdir}>
                    {shortenHomePath(selectedTopic.workdir)}
                  </span>
                ) : null}
                {selectedTopic.model && (
                  <span className="model-hint" title="活跃模型">{selectedTopic.model}</span>
                )}
              </div>
              <div className="spacer" />
              {/* Bypass is a state, not an action — use toggle, not button. */}
              <button
                type="button"
                className={`toggle ${selectedTopic.dangerMode ? "on" : ""}`}
                onClick={() => onToggleDangerMode(selectedTopic.id, !selectedTopic.dangerMode)}
                title={selectedTopic.dangerMode
                  ? "Bypass 模式开启：工具调用不再弹授权框。点击关闭。"
                  : "默认权限：每次工具调用都会请求授权。点击开启 Bypass。"}
              >
                <span className="toggle-track" />
                <span>Bypass</span>
              </button>
              {dangerHintTopicId === selectedTopic.id && (
                <span className="danger-hint">下次发送起生效</span>
              )}
              <button
                className="btn btn-sm btn-ghost"
                title="在本 Topic 内搜索对话（⌘F）"
                onClick={() => window.dispatchEvent(new CustomEvent("salmon:open-topic-search"))}
              >
                <svg viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m20 20-4.3-4.3" />
                </svg>
                <span>搜索</span>
                <kbd>⌘F</kbd>
              </button>
              <div className="stat">
                {selectedMessages.length} msg
                {(() => {
                  const total = selectedMessages.reduce(
                    (n, m) => n + (m.tokenIn || 0) + (m.tokenOut || 0),
                    0,
                  );
                  if (total === 0) return null;
                  return (
                    <span style={{ marginLeft: 6 }} title="本 Topic 累计 tokens (in + out)">
                      · {formatTokensCompact(total)}
                    </span>
                  );
                })()}
              </div>
            </div>
            <ChatStream
              key={selectedTopic.id}
              topic={selectedTopic}
              anticipating={(anticipatingByTopic[selectedTopic.id] || 0) > 0}
              messages={selectedMessages}
              pendingPermission={pendingPermByTopic[selectedTopic.id] || null}
              errorBanner={errorByTopic[selectedTopic.id] || null}
              chatLayout={chatLayout}
              busy={!!busyByTopic[selectedTopic.id]}
              workdirMissing={workdirOkByTopic[selectedTopic.id] === false}
              onArchive={() => onArchive(selectedTopic.id, true)}
              onDelete={async () => {
                const ok = await ask(
                  `确认删除 Topic "${selectedTopic.title}"?\n（仅删除 SalmonApp 内的对话记录）`,
                  { title: "删除 Topic", kind: "warning" },
                );
                if (ok) onDelete(selectedTopic.id);
              }}
              onRetryTopic={() => onRetryTopic(selectedTopic.id)}
              onRefreshClis={() => { void refresh(); }}
              onResetSession={() => onResetSession(selectedTopic.id)}
              onApprovePermission={onApprove}
              onSelectTool={setSelectedTool}
            />
            <Composer
              topicId={selectedTopic.id}
              busy={!!busyByTopic[selectedTopic.id]}
              disabled={workdirOkByTopic[selectedTopic.id] === false}
              sendMode={composerSendMode}
              onSend={onSend}
              onInterrupt={onInterrupt}
            />
          </section>
          {rightCollapsed ? (
            <RightRail onExpand={toggleRight} />
          ) : (
            <RightPane
              topic={selectedTopic}
              selectedTool={selectedTool}
              logs={logsByTopic[selectedTopic.id] || []}
              refreshKey={filesRefreshKey}
              onCollapse={toggleRight}
            />
          )}
        </>
      )}
      </>)}

      {showNew && (
        <NewTopicDialog
          cliStatus={cliStatus}
          defaultEngine={defaultEngine}
          topics={topics}
          onCancel={() => setShowNew(false)}
          onCreate={onCreateTopic}
        />
      )}

      {showSettings && (
        <SettingsDialog
          chatLayout={chatLayout}
          composerSendMode={composerSendMode}
          defaultEngine={defaultEngine}
          cliStatus={cliStatus}
          usageSummary={usageSummary}
          notifySoundEnabled={notifySoundEnabled}
          desktopModeEnabled={desktopModeEnabled}
          onChangeChatLayout={onChangeChatLayout}
          onChangeComposerSendMode={onChangeComposerSendMode}
          onChangeDefaultEngine={onChangeDefaultEngine}
          onChangeNotifySound={onChangeNotifySound}
          onChangeDesktopMode={onChangeDesktopMode}
          initialTab={settingsInitialTab}
          onClose={() => { setShowSettings(false); setSettingsInitialTab(undefined); }}
        />
      )}

      {showSearch && (
        <SearchDialog
          topics={topics}
          initialQuery={searchInitialQuery}
          onNavigate={navigateActionTarget}
          onClose={() => setShowSearch(false)}
        />
      )}

      {renamingTopicId && (() => {
        const t = topics.find((x) => x.id === renamingTopicId);
        if (!t) return null;
        return (
          <PromptDialog
            title="重命名 Topic"
            initialValue={t.title}
            confirmLabel="保存"
            onCancel={() => setRenamingTopicId(null)}
            onConfirm={(v) => {
              if (v !== t.title) onRename(t.id, v);
              setRenamingTopicId(null);
            }}
          />
        );
      })()}

      <Toasts
        toasts={toasts}
        onDismiss={dismissToast}
        onClick={onToastClick}
        onAction={navigateActionTarget}
      />
      {/* v1.17.0: global ⌘K AI button. FAB lives in the app root so it
          sits above every view's content. The button itself decides when
          to render the popover based on its own open state.
          v1.18.2: skipped entirely inside Topic view — the FAB collided
          with the Composer's send button at the bottom-right, and inside
          a Topic the user already has the composer for AI conversation,
          so a separate "new Topic from here" entry is redundant. ⌘K
          also won't fire (the listener lives inside the component) which
          matches the FAB-gone intent. */}
      {!selectedTopic && (
        <GlobalAIButton context={currentAIContext} onSubmit={onAISubmit} />
      )}
    </div>
  );
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** v1.17.0: derive a short Topic title from the AI button's first user
 *  message. We just trim + take the first ~20 chars; the existing
 *  suggest_topic_title background job kicks in after the first
 *  assistant reply and replaces this with something better. */
function deriveAITopicTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "新建 Topic";
  return t.length > 20 ? t.slice(0, 19) + "…" : t;
}

/** v1.17.0: turn the structured GlobalAIContext into a system message
 *  prepended to the new Topic. Empty / home / topic-recurse cases
 *  return "" so we skip the append. */
function formatAIContextSeed(ctx: GlobalAIContext): string {
  const lines: string[] = ["【SalmonApp 上下文 — 用户用 ⌘K 从某个视图发起此对话】"];
  switch (ctx.kind) {
    case "home":
      return "";
    case "mail": {
      if (!ctx.messageId) {
        lines.push("视图：邮件 / 收件箱列表（未选中具体邮件）");
        break;
      }
      lines.push("视图：邮件 / 详情");
      lines.push(`- 邮件 id：${ctx.messageId}`);
      if (ctx.threadId) lines.push(`- thread id：${ctx.threadId}`);
      if (ctx.subject) lines.push(`- 主题：${ctx.subject}`);
      const who = [ctx.fromName, ctx.fromEmail ? `<${ctx.fromEmail}>` : ""].filter(Boolean).join(" ");
      if (who) lines.push(`- 发件人：${who}`);
      if (ctx.accountId) lines.push(`- 账号 id：${ctx.accountId}`);
      lines.push("- 如需更多细节用 salmon-query mail.get / mail.thread。");
      break;
    }
    case "calendar":
      lines.push("视图：日历");
      if (ctx.selectedEventId) {
        lines.push(`- 选中事件 id：${ctx.selectedEventId}`);
        if (ctx.selectedTitle) lines.push(`- 标题：${ctx.selectedTitle}`);
        lines.push("- 用 salmon-query calendar.list 取窗口、用 mail.search 拉相关邮件。");
      } else {
        lines.push("- 未选中具体事件；如果用户指代'某场会议'请先 calendar.list 拉今/明日。");
      }
      break;
    case "tasks":
      lines.push("视图：待办");
      if (ctx.selectedTaskId) {
        lines.push(`- 选中待办 id：${ctx.selectedTaskId}`);
        if (ctx.selectedTitle) lines.push(`- 标题：${ctx.selectedTitle}`);
      } else {
        lines.push(`- 未选中具体待办；过滤=${ctx.filter ?? "pending"}。`);
        lines.push("- 用 salmon-query tasks.list 取列表。");
      }
      break;
    case "contacts":
      lines.push("视图：联系人");
      if (ctx.selectedEmail) {
        lines.push(`- 选中联系人：${ctx.selectedName ?? ""} <${ctx.selectedEmail}>`);
        lines.push("- 用 salmon-query contacts.detail 取 30 天 360。");
      } else {
        lines.push("- 未选中具体联系人。");
      }
      break;
    case "briefing":
      lines.push("视图：首页 / 推荐");
      if (ctx.focusedItemId) {
        lines.push(`- 当前关注的推荐项：${ctx.focusedTitle ?? ctx.focusedItemId}`);
      }
      break;
    case "topic":
      return ""; // recursing from a Topic — context is already implicit
  }
  lines.push("");
  lines.push("用户接下来的消息可能用'这件事 / 这封 / 这个'指代上面这些。");
  return lines.join("\n");
}

/** v1.19.0: shorten a filesystem path for the mid-head breadcrumb.
 *  Replaces $HOME prefix with "~" and trims the middle if too long,
 *  leaving the last two segments visible. The full path is kept in
 *  the parent's tooltip so users can hover to see everything. */
function shortenHomePath(p: string): string {
  const home = (window as any).__SALMON_HOME__ || "";
  let q = p;
  if (home && p.startsWith(home)) q = "~" + p.slice(home.length);
  if (q.length <= 32) return q;
  const parts = q.split("/").filter(Boolean);
  if (parts.length <= 2) return q;
  return "…/" + parts.slice(-2).join("/");
}

function formatTokensCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Compose the auto-send prompt for "同意 · 开干". Folds title + rationale +
// payoff + action_hint into one structured brief so the assistant gets the
// same context the user sees on the rec card. Empty fields are skipped.
function buildAcceptPrompt(rec: Recommendation): string {
  const title = rec.title?.trim() ?? "";
  const rationale = rec.rationale?.trim() ?? "";
  const payoff = rec.payoff?.trim() ?? "";
  const action = rec.actionHint?.trim() ?? "";
  const parts: string[] = [];
  if (title) parts.push(title);
  if (rationale) parts.push(`【起因】${rationale}`);
  if (payoff) parts.push(`【期望产出】${payoff}`);
  if (action) parts.push(`【请按这一步开始】${action}`);
  if (parts.length === 0) return "";
  // Single-field rec (legacy or empty) — keep it as a one-liner without the
  // structured headers, since they'd just add noise.
  if (parts.length === 1) return parts[0].replace(/^【[^】]+】/, "");
  return parts.join("\n\n");
}

function RightRail({ onExpand }: { onExpand: () => void }) {
  const mod = /mac|iphone|ipad|ipod/i.test(navigator.platform) ? "⌘" : "Ctrl";
  return (
    <aside className="right-rail" title={`展开右栏 (${mod}+\\)`} onClick={onExpand}>
      <button className="btn btn-sm btn-icon btn-ghost">◂</button>
    </aside>
  );
}

function newAssistantMessage(id: string): UiMessage {
  return {
    id,
    role: "assistant",
    content: "",
    blocks: [],
    tools: [],
    pending: true,
    createdAt: Date.now(),
  };
}

function findLatestPendingAssistantIndex(messages: UiMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].pending) return i;
  }
  return -1;
}

function hydrate(msgs: Message[]): UiMessage[] {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    blocks: m.content
      ? [{ kind: "text" as const, content: m.content, createdAt: m.createdAt }]
      : [],
    tools: [],
    createdAt: m.createdAt,
    tokenIn: m.tokenIn ?? undefined,
    tokenOut: m.tokenOut ?? undefined,
    durationMs: m.durationMs ?? undefined,
  }));
}
