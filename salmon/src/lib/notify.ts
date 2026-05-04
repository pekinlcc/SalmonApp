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

export type NotifyKind = "permission" | "done" | "error" | "crash" | "recs";

export interface NotifyOpts {
  /** Null = not tied to a topic (e.g. recommendations roundup). */
  topicId: string | null;
  kind: NotifyKind;
  title: string;
  body: string;
}

export interface ToastEvent {
  id: string;
  topicId: string | null;
  kind: NotifyKind;
  title: string;
  body: string;
  createdAt: number;
}

const COOLDOWN_MS = 5000;
const lastByKey = new Map<string, number>();
let permCache: boolean | null = null;

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

  if (isWindowFocused) {
    pushToast({
      id: newId(),
      topicId: opts.topicId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      createdAt: now,
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
