// Spawn / focus separate Tauri windows for individual apps when running
// inside the SalmonApp Desktop shell. Each "app" gets its own native
// window with a `?view=mail` (etc.) URL so App.tsx can render just that
// surface, dropping the desktop chrome entirely.
//
// Used only when the current window's label is "shell" — i.e. inside
// the Desktop binary. In the regular SalmonApp App binary, dock clicks
// fall back to in-app navigation (no new windows).
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type AppView = "mail" | "calendar" | "tasks" | "home" | "contacts" | "settings";

interface WindowSpec {
  label: string;
  title: string;
  width: number;
  height: number;
}

const SPECS: Record<AppView, WindowSpec> = {
  mail:     { label: "app-mail",     title: "Salmon Mail",     width: 1100, height: 760 },
  calendar: { label: "app-calendar", title: "Salmon Calendar", width: 1100, height: 760 },
  tasks:    { label: "app-tasks",    title: "Salmon Tasks",    width: 900,  height: 700 },
  home:     { label: "app-home",     title: "SalmonApp",       width: 1280, height: 800 },
  contacts: { label: "app-contacts", title: "Salmon Contacts", width: 1000, height: 720 },
  settings: { label: "app-settings", title: "Salmon Settings", width: 800,  height: 640 },
};

export function isShellWindow(): boolean {
  try {
    return getCurrentWindow().label === "shell";
  } catch {
    return false;
  }
}

/** Open a separate window for the given view, or focus it if already open. */
export async function openAppWindow(view: AppView): Promise<void> {
  const spec = SPECS[view];
  if (!spec) return;

  // Focus existing instance if already open.
  const existing = await WebviewWindow.getByLabel(spec.label);
  if (existing) {
    try {
      await existing.unminimize();
      await existing.setFocus();
      return;
    } catch {
      // Fall through to recreate
    }
  }

  // Tauri 2 — relative URL is resolved against the app's frontend dist.
  // We use a hash route (#/?view=mail) instead of a real query string so
  // production builds (frontendDist:"../dist") don't choke on missing
  // index.html?... paths. App.tsx reads the hash on mount.
  const url = `index.html#view=${view}`;
  const w = new WebviewWindow(spec.label, {
    url,
    title: spec.title,
    width: spec.width,
    height: spec.height,
    minWidth: 640,
    minHeight: 480,
    decorations: true,
    resizable: true,
    focus: true,
  });
  w.once("tauri://error", (e) => {
    // eslint-disable-next-line no-console
    console.error(`Failed to open ${spec.label} window:`, e);
  });
}

/** Parse the current window's hash to figure out which view, if any, was
 *  requested. Returns null for the shell window or the App binary's main
 *  window (both render the normal DesktopView / App layout). */
export function viewFromHash(): AppView | null {
  try {
    const h = window.location.hash;
    const m = h.match(/[#&?]view=([a-z]+)/);
    if (!m) return null;
    const v = m[1] as AppView;
    if (v in SPECS) return v;
    return null;
  } catch {
    return null;
  }
}
