// Centralised notification dispatcher used by App.tsx event handlers.
//
// Behaviour:
// - When the OS window is focused, route through an in-app toast instead of
//   a system notification — popping a system banner over the foreground app
//   is annoying.
// - When the window is not focused, send a system notification via the Tauri
//   plugin (works on macOS Notification Center + Linux libnotify daemons).
// - Per (kind, topicId) cooldown so a stuck loop can't spam the user.
// - Permission is asked at most once per session and cached.
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

export type NotifyKind = "permission" | "done" | "error" | "crash" | "recs" | "info";

export type ToastActionTarget =
  | { view: "topic"; topicId: string }
  | { view: "calendar"; eventId?: string | null; accountId?: string | null; startMs?: number | null }
  | { view: "tasks"; taskId?: string | null; accountId?: string | null }
  | { view: "mail"; messageId?: string | null; accountId?: string | null };

export interface ToastAction {
  label: string;
  target: ToastActionTarget;
  primary?: boolean;
}

export interface NotifyOpts {
  /** Null = not tied to a topic (e.g. recommendations roundup). */
  topicId: string | null;
  kind: NotifyKind;
  title: string;
  body: string;
  actions?: ToastAction[];
}

export interface ToastEvent {
  id: string;
  topicId: string | null;
  kind: NotifyKind;
  title: string;
  body: string;
  createdAt: number;
  actions?: ToastAction[];
}

const COOLDOWN_MS = 5000;
const lastByKey = new Map<string, number>();
let permCache: boolean | null = null;

// Sound-on-task-complete preference. Default ON; App.tsx loads the
// persisted value from the DB at mount and pushes updates through
// setNotifySoundEnabled() so this module stays a one-way data sink.
let soundEnabled = true;
export function setNotifySoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
}

// Lazy-init shared AudioContext. The OS-level "is sound allowed?" gate is
// fundamentally outside the WebView, so we just try to play and let the
// audio stack drop the buffer if the user has the system muted. Auto-play
// policies require a user gesture before resume(), but a SalmonApp session
// involves at least one click well before any task completes, so by then
// the context is usable.
let audioCtx: AudioContext | null = null;
function ensureAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor: typeof AudioContext | undefined =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/** Play a brief two-tone "ding" via Web Audio. No asset bundling. */
export function playChime() {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const start = ctx.currentTime;
  const note = (freq: number, offset: number, dur: number, peak: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain).connect(ctx.destination);
    // Envelope: 20ms attack → hold → 80ms fade. Avoids click artefacts
    // at start/stop and gives the chime a soft tail.
    const t = start + offset;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.02);
    gain.gain.linearRampToValueAtTime(peak, t + dur - 0.08);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t);
    osc.stop(t + dur);
  };
  // Ascending major sixth, ~340ms total. Friendly, not alarmy.
  note(660, 0, 0.14, 0.16);
  note(880, 0.16, 0.20, 0.16);
}

async function ensurePermission(): Promise<boolean> {
  if (permCache === true) return true;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    permCache = granted;
    return granted;
  } catch {
    permCache = false;
    return false;
  }
}

function newId(): string {
  const c = (globalThis as any).crypto;
  return c?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function notify(
  opts: NotifyOpts,
  isWindowFocused: boolean,
  pushToast: (t: ToastEvent) => void
): Promise<void> {
  const key = `${opts.kind}:${opts.topicId ?? "_global"}`;
  const now = Date.now();
  const last = lastByKey.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) return;
  lastByKey.set(key, now);

  // Chime fires for completed tasks regardless of focus — same cue
  // whether the user has the window in front or is doing something else
  // and just needs to know the agent is back.
  if (opts.kind === "done" && soundEnabled) {
    try { playChime(); } catch { /* no-op */ }
  }

  if (isWindowFocused) {
    pushToast({
      id: newId(),
      topicId: opts.topicId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      createdAt: now,
      actions: opts.actions,
    });
    return;
  }

  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title: opts.title, body: opts.body });
  } catch (e) {
    // Plugin failure (no notification daemon on Linux, etc.) — degrade
    // silently. Toast path still works inside the app.
    // eslint-disable-next-line no-console
    console.warn("notify: sendNotification failed", e);
  }
}
