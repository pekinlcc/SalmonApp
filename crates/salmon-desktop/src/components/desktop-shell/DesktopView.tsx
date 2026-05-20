// Top-level Ubuntu Desktop shell — v2 high-fidelity port.
//
// Mounted by App.tsx when `topView === "desktop"`. On Linux this is the
// default first-launch view; on Mac/Windows it's hidden in Settings.
//
// Centralized orchestration that the design's app.jsx kept inline:
//   - aiOpen / aiHover state for the AI Live Tile interactions
//   - showCenterWidget = !aiOpen && !aiHover  (so we never show two
//     copies of the same brief at once)
//   - widgetMode that the dock popovers can mutate
//
// Data comes from useDesktopBrief — real Tauri commands hitting SQLite.
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import "./desktop.css";
import { Wallpaper, WALLPAPER_VARIANTS, type WallpaperFit, type WallpaperVariant } from "./Wallpaper";
import { TopBar } from "./TopBar";
import { Widget, type WidgetMode, type WidgetCallbacks } from "./Widget";
import { Dock } from "./Dock";
import { Launcher } from "./Launcher";
import { Icons } from "./Icons";
import { AILiveTile } from "./AILiveTile";
import { AIPeek } from "./AIPeek";
import { AIPopover } from "./AIPopover";
import { ActivitiesOverview, type ActivitiesWorkspace } from "./ActivitiesOverview";
import { WelcomeOverlay } from "./WelcomeOverlay";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { useDesktopBrief, briefItemCount } from "../../lib/useDesktopBrief";
import { isShellWindow, openAppWindow } from "../../lib/openAppWindow";
import { api, type SystemAppKind } from "../../lib/api";
import type { FileEntry } from "../../lib/types";

const WALLPAPER_STORAGE_KEY = "salmon.desktop.wallpaper";
const WELCOME_STORAGE_KEY = "salmon.desktop.welcomed";

function loadWelcomeNeeded(): boolean {
  try {
    return !localStorage.getItem(WELCOME_STORAGE_KEY);
  } catch {
    return false;
  }
}
type DesktopTheme = "system" | "dark" | "light";
type DesktopAccent = "salmon" | "blue" | "green" | "purple";
type WallpaperSlideshowMinutes = 0 | 5 | 15 | 30 | 60;

const WALLPAPER_FITS: { id: WallpaperFit; label: string }[] = [
  { id: "cover", label: "填充" },
  { id: "contain", label: "适应" },
  { id: "fill", label: "拉伸" },
  { id: "center", label: "居中" },
];

const DESKTOP_THEMES: { id: DesktopTheme; label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
];

const DESKTOP_ACCENTS: { id: DesktopAccent; label: string }[] = [
  { id: "salmon", label: "Salmon" },
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "purple", label: "Purple" },
];

const WALLPAPER_SLIDESHOWS: { minutes: WallpaperSlideshowMinutes; label: string }[] = [
  { minutes: 0, label: "关闭" },
  { minutes: 5, label: "5 分钟" },
  { minutes: 15, label: "15 分钟" },
  { minutes: 30, label: "30 分钟" },
  { minutes: 60, label: "60 分钟" },
];

const TEXT_SCALE_OPTIONS = [
  { factor: 0.9, label: "90%" },
  { factor: 1, label: "100%" },
  { factor: 1.1, label: "110%" },
  { factor: 1.25, label: "125%" },
  { factor: 1.5, label: "150%" },
];

function loadWallpaper(): WallpaperVariant {
  try {
    const saved = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (saved && WALLPAPER_VARIANTS.some((v) => v.id === saved)) {
      return saved as WallpaperVariant;
    }
  } catch {}
  return "horizon";
}

interface Props {
  onExitDesktop: () => void;
  onNavigateHome: () => void;
  onNavigateMail: () => void;
  onNavigateCalendar: () => void;
  onNavigateTasks: () => void;
  onNavigateContacts: () => void;
  onNewTopic: () => void;
  onOpenSearch: (q?: string) => void;
  onOpenSettings: () => void;
}

interface OpenWindowItem {
  key: string;
  kind: "salmon" | "external";
  id?: string;
  label?: string;
  appId?: string;
  title: string;
  ambiguous?: boolean;
}

interface SystemAppStatus {
  filesRunning: boolean;
  browserRunning: boolean;
  terminalRunning: boolean;
  settingsRunning: boolean;
}

const EMPTY_SYSTEM_APP_STATUS: SystemAppStatus = {
  filesRunning: false,
  browserRunning: false,
  terminalRunning: false,
  settingsRunning: false,
};

export function DesktopView(props: Props) {
  const brief = useDesktopBrief(true);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiHover, setAiHover] = useState(false);
  const [wallpaper, setWallpaper] = useState<WallpaperVariant>(loadWallpaper);
  const [wallpaperImagePath, setWallpaperImagePath] = useState<string | null>(null);
  const [wallpaperFit, setWallpaperFit] = useState<WallpaperFit>("cover");
  const [wallpaperSlideshowMinutes, setWallpaperSlideshowMinutes] = useState<WallpaperSlideshowMinutes>(0);
  const [desktopTheme, setDesktopTheme] = useState<DesktopTheme>("system");
  const [desktopAccent, setDesktopAccent] = useState<DesktopAccent>("salmon");
  const [gtkTheme, setGtkTheme] = useState<string>("");
  const [iconTheme, setIconTheme] = useState<string>("");
  const [cursorTheme, setCursorTheme] = useState<string>("");
  const [interfaceFontFamily, setInterfaceFontFamily] = useState<string>("");
  const [documentFontFamily, setDocumentFontFamily] = useState<string>("");
  const [monospaceFontFamily, setMonospaceFontFamily] = useState<string>("");
  const [textScalingFactor, setTextScalingFactor] = useState<number>(1);
  const [gtkThemes, setGtkThemes] = useState<string[]>([]);
  const [iconThemes, setIconThemes] = useState<string[]>([]);
  const [cursorThemes, setCursorThemes] = useState<string[]>([]);
  const [fontFamilies, setFontFamilies] = useState<string[]>([]);
  const [monospaceFontFamilies, setMonospaceFontFamilies] = useState<string[]>([]);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; item: FileEntry } | null>(null);
  const [desktopToast, setDesktopToast] = useState<string | null>(null);
  const [windowSwitcherOpen, setWindowSwitcherOpen] = useState(false);
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [overviewWorkspaces, setOverviewWorkspaces] = useState<ActivitiesWorkspace[]>([]);
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(() => loadWelcomeNeeded());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [openWindows, setOpenWindows] = useState<OpenWindowItem[]>([]);
  const [systemAppStatus, setSystemAppStatus] = useState<SystemAppStatus>(EMPTY_SYSTEM_APP_STATUS);
  const [desktopItems, setDesktopItems] = useState<FileEntry[]>([]);
  const count = briefItemCount(brief);

  const showToast = useCallback((message: string) => {
    setDesktopToast(message);
    window.setTimeout(() => setDesktopToast((cur) => cur === message ? null : cur), 2200);
  }, []);

  // GNOME/Wayland often ignores Tauri's startup `fullscreen: true` hint
  // because GTK's fullscreen request races the X/Wayland window-mapping
  // step. Force it at runtime once React mounts — and provide F11 to
  // toggle in case the user wants to peek at GNOME without quitting.
  useEffect(() => {
    const w = getCurrentWindow();
    if (w.label !== "shell") return;
    // Tiny delay lets the window finish mapping before we re-issue the
    // hint; without it the request sometimes lands before GTK's realize
    // step and gets silently dropped.
    const t = setTimeout(() => { w.setFullscreen(true).catch(() => {}); }, 80);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F11") return;
      e.preventDefault();
      const w = getCurrentWindow();
      w.isFullscreen().then((cur) => { w.setFullscreen(!cur).catch(() => {}); });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    api.restoreNightLight().catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    api.getDesktopAppearance()
      .then((appearance) => {
        if (!alive) return;
        if (appearance.wallpaper === "image" && appearance.wallpaperPath) {
          setWallpaperImagePath(appearance.wallpaperPath);
        } else {
          const builtin = WALLPAPER_VARIANTS.some((v) => v.id === appearance.wallpaper)
            ? appearance.wallpaper as WallpaperVariant
            : "horizon";
          setWallpaperImagePath(null);
          setWallpaper(builtin);
          try {
            localStorage.setItem(WALLPAPER_STORAGE_KEY, builtin);
          } catch {}
        }
        setWallpaperFit(appearance.wallpaperFit);
        setWallpaperSlideshowMinutes(appearance.slideshowMinutes);
        setDesktopTheme(appearance.theme);
        setDesktopAccent(appearance.accent);
        setGtkTheme(appearance.gtkTheme ?? appearance.gtkThemes[0] ?? "");
        setIconTheme(appearance.iconTheme ?? appearance.iconThemes[0] ?? "");
        setCursorTheme(appearance.cursorTheme ?? appearance.cursorThemes[0] ?? "");
        setInterfaceFontFamily(appearance.interfaceFontFamily ?? appearance.fontFamilies[0] ?? "");
        setDocumentFontFamily(appearance.documentFontFamily ?? appearance.fontFamilies[0] ?? "");
        setMonospaceFontFamily(appearance.monospaceFontFamily ?? appearance.monospaceFontFamilies[0] ?? "");
        setTextScalingFactor(appearance.textScalingFactor || 1);
        setGtkThemes(appearance.gtkThemes);
        setIconThemes(appearance.iconThemes);
        setCursorThemes(appearance.cursorThemes);
        setFontFamilies(appearance.fontFamilies);
        setMonospaceFontFamilies(appearance.monospaceFontFamilies);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Auto widget mode: idle (no items) → collapsed (1 item) → overview (2+).
  // The user can override by clicking action buttons inside the widget.
  const [manualMode, setManualMode] = useState<WidgetMode | null>(null);
  const autoMode: WidgetMode = count === 0 ? "idle" : count === 1 ? "collapsed" : "overview";
  const widgetMode: WidgetMode = manualMode ?? autoMode;
  // Reset manual override whenever the data shape changes class so the
  // widget re-adapts to new conditions instead of being stuck in a stale
  // pose (e.g. user collapses → mail arrives → should re-open).
  useEffect(() => {
    setManualMode(null);
  }, [autoMode]);

  // Hide the center widget when the AI tile is showing peek/popover — they
  // would otherwise overlap and confuse the user. (Matches design app.jsx.)
  const showCenterWidget = !aiOpen && !aiHover;

  const chooseWallpaper = useCallback((next: WallpaperVariant, message = "外观已保存") => {
    setWallpaper(next);
    setWallpaperImagePath(null);
    try {
      localStorage.setItem(WALLPAPER_STORAGE_KEY, next);
    } catch {}
    api.setDesktopWallpaper(next)
      .then(() => showToast(message))
      .catch(() => showToast("外观保存失败"));
  }, [showToast]);

  const cycleWallpaper = useCallback(() => {
    const i = WALLPAPER_VARIANTS.findIndex((v) => v.id === wallpaper);
    const next = WALLPAPER_VARIANTS[(i + 1) % WALLPAPER_VARIANTS.length].id;
    chooseWallpaper(next, "壁纸已切换");
  }, [chooseWallpaper, wallpaper]);

  useEffect(() => {
    if (wallpaperSlideshowMinutes <= 0 || wallpaperImagePath) return;
    const interval = window.setInterval(() => {
      cycleWallpaper();
    }, wallpaperSlideshowMinutes * 60_000);
    return () => window.clearInterval(interval);
  }, [cycleWallpaper, wallpaperImagePath, wallpaperSlideshowMinutes]);

  const chooseWallpaperImage = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const appearance = await api.setDesktopWallpaperImage(selected);
      if (appearance.wallpaperPath) {
        setWallpaperImagePath(appearance.wallpaperPath);
        setWallpaperFit(appearance.wallpaperFit);
        setWallpaperSlideshowMinutes(appearance.slideshowMinutes);
        setDesktopTheme(appearance.theme);
        setDesktopAccent(appearance.accent);
        setGtkTheme(appearance.gtkTheme ?? appearance.gtkThemes[0] ?? "");
        setIconTheme(appearance.iconTheme ?? appearance.iconThemes[0] ?? "");
        setCursorTheme(appearance.cursorTheme ?? appearance.cursorThemes[0] ?? "");
        setInterfaceFontFamily(appearance.interfaceFontFamily ?? appearance.fontFamilies[0] ?? "");
        setDocumentFontFamily(appearance.documentFontFamily ?? appearance.fontFamilies[0] ?? "");
        setMonospaceFontFamily(appearance.monospaceFontFamily ?? appearance.monospaceFontFamilies[0] ?? "");
        setTextScalingFactor(appearance.textScalingFactor || 1);
        setGtkThemes(appearance.gtkThemes);
        setIconThemes(appearance.iconThemes);
        setCursorThemes(appearance.cursorThemes);
        setFontFamilies(appearance.fontFamilies);
        setMonospaceFontFamilies(appearance.monospaceFontFamilies);
        showToast("壁纸已设置");
      }
    } catch (err) {
      showToast("壁纸设置失败");
      // eslint-disable-next-line no-console
      console.error("set_desktop_wallpaper_image:", err);
    }
  }, [showToast]);

  const chooseWallpaperFit = useCallback((fit: WallpaperFit) => {
    setWallpaperFit(fit);
    api.setDesktopWallpaperFit(fit)
      .then(() => showToast("壁纸填充已保存"))
      .catch(() => showToast("外观保存失败"));
  }, [showToast]);

  const chooseWallpaperSlideshow = useCallback((minutes: WallpaperSlideshowMinutes) => {
    setWallpaperSlideshowMinutes(minutes);
    api.setDesktopWallpaperSlideshow(minutes)
      .then(() => showToast(minutes > 0 ? "壁纸轮换已保存" : "壁纸轮换已关闭"))
      .catch(() => showToast("壁纸轮换保存失败"));
  }, [showToast]);

  const chooseDesktopTheme = useCallback((theme: DesktopTheme) => {
    setDesktopTheme(theme);
    api.setDesktopTheme(theme)
      .then(() => showToast("主题已保存"))
      .catch(() => showToast("主题保存失败"));
  }, [showToast]);

  const chooseDesktopAccent = useCallback((accent: DesktopAccent) => {
    setDesktopAccent(accent);
    api.setDesktopAccent(accent)
      .then(() => showToast("强调色已保存"))
      .catch(() => showToast("强调色保存失败"));
  }, [showToast]);

  const chooseGtkTheme = useCallback((theme: string) => {
    if (!theme) return;
    setGtkTheme(theme);
    api.setDesktopGtkTheme(theme)
      .then(() => showToast("应用主题已保存"))
      .catch(() => showToast("应用主题保存失败"));
  }, [showToast]);

  const chooseIconTheme = useCallback((theme: string) => {
    if (!theme) return;
    setIconTheme(theme);
    api.setDesktopIconTheme(theme)
      .then(() => showToast("图标主题已保存"))
      .catch(() => showToast("图标主题保存失败"));
  }, [showToast]);

  const chooseCursorTheme = useCallback((theme: string) => {
    if (!theme) return;
    setCursorTheme(theme);
    api.setDesktopCursorTheme(theme)
      .then(() => showToast("光标主题已保存"))
      .catch(() => showToast("光标主题保存失败"));
  }, [showToast]);

  const chooseFontFamily = useCallback((kind: "interface" | "document" | "monospace", family: string) => {
    if (!family) return;
    if (kind === "interface") setInterfaceFontFamily(family);
    if (kind === "document") setDocumentFontFamily(family);
    if (kind === "monospace") setMonospaceFontFamily(family);
    api.setDesktopFontFamily(kind, family)
      .then(() => showToast("系统字体已保存"))
      .catch(() => showToast("系统字体保存失败"));
  }, [showToast]);

  const chooseTextScalingFactor = useCallback((factor: number) => {
    setTextScalingFactor(factor);
    api.setDesktopTextScalingFactor(factor)
      .then(() => showToast("文字缩放已保存"))
      .catch(() => showToast("文字缩放保存失败"));
  }, [showToast]);

  const refreshOpenWindows = useCallback(async (): Promise<OpenWindowItem[]> => {
    const wins = await getAllWebviewWindows();
    const salmonRows: OpenWindowItem[] = await Promise.all(
      wins
        .filter((w) => w.label !== "shell")
        .map(async (w) => ({
          key: `salmon:${w.label}`,
          kind: "salmon" as const,
          label: w.label,
          title: await w.title().catch(() => w.label),
        })),
    );
    const externalRows: OpenWindowItem[] = await api.listExternalWindows()
      .then((rows) => rows.map((w, index) => ({
        key: `external:${index}:${w.id}`,
        kind: "external" as const,
        id: w.id,
        appId: w.appId,
        title: w.title || w.appId,
        ambiguous: w.ambiguous,
      })))
      .catch(() => []);
    const rows = [...salmonRows, ...externalRows];
    setOpenWindows(rows);
    return rows;
  }, []);

  const refreshDesktopItems = useCallback(() => {
    api.listDesktopItems()
      .then((items) => setDesktopItems(items))
      .catch(() => setDesktopItems([]));
  }, []);

  const refreshSystemApps = useCallback(() => {
    api.getSystemAppStatus()
      .then(setSystemAppStatus)
      .catch(() => setSystemAppStatus(EMPTY_SYSTEM_APP_STATUS));
  }, []);

  useEffect(() => {
    refreshDesktopItems();
    const t = setInterval(refreshDesktopItems, 15_000);
    return () => clearInterval(t);
  }, [refreshDesktopItems]);

  useEffect(() => {
    refreshOpenWindows().catch(() => {});
    const t = setInterval(() => { refreshOpenWindows().catch(() => {}); }, 2_500);
    return () => clearInterval(t);
  }, [refreshOpenWindows]);

  // Opening the Activities Overview should reflect the current
  // compositor state — fresh window list and current workspace
  // markers — without waiting for the 2.5s polling tick.
  useEffect(() => {
    if (!activitiesOpen) return;
    refreshOpenWindows().catch(() => {});
    api.listWorkspaces()
      .then((rows) => setOverviewWorkspaces(rows))
      .catch(() => setOverviewWorkspaces([]));
  }, [activitiesOpen, refreshOpenWindows]);

  useEffect(() => {
    refreshSystemApps();
    const t = setInterval(refreshSystemApps, 5_000);
    return () => clearInterval(t);
  }, [refreshSystemApps]);

  // When running as the SalmonApp Desktop shell (Tauri window labeled
  // "shell"), every "open Mail / Calendar / ..." action spawns a separate
  // OS-level Tauri window instead of switching the shell's own view. This
  // makes the desktop feel like a real shell — apps are independent
  // windows you can move/close/minimize. In the SalmonApp App binary the
  // dock falls back to in-app navigation (no new windows).
  const shellMode = isShellWindow();
  const navigate = {
    mail: shellMode ? () => openAppWindow("mail") : props.onNavigateMail,
    calendar: shellMode ? () => openAppWindow("calendar") : props.onNavigateCalendar,
    tasks: shellMode ? () => openAppWindow("tasks") : props.onNavigateTasks,
    home: shellMode ? () => openAppWindow("home") : props.onNavigateHome,
    contacts: shellMode ? () => openAppWindow("contacts") : props.onNavigateContacts,
    settings: shellMode ? () => openAppWindow("settings") : props.onOpenSettings,
  };

  // Super (Meta) toggles launcher. Super+1..9 hits dock shortcuts in the
  // same left-to-right order shown in the dock.
  const shortcutHandlers: Record<number, () => void> = {
    1: navigate.mail,
    2: navigate.calendar,
    3: navigate.tasks,
    4: navigate.home,
    9: navigate.settings,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Meta" || e.key === "OS") && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        setLauncherOpen((v) => !v);
        return;
      }
      if (e.metaKey && /^[1-9]$/.test(e.key)) {
        const n = parseInt(e.key, 10);
        const handler = shortcutHandlers[n];
        if (handler) {
          e.preventDefault();
          handler();
        }
      }
      if (e.altKey && e.key === "Tab") {
        e.preventDefault();
        refreshOpenWindows()
          .then((rows) => {
            if (rows.length > 0) setWindowSwitcherOpen(true);
          })
          .catch(() => {});
      }
      // Super+A — GNOME-style Activities Overview shortcut
      if (e.metaKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setActivitiesOpen((v) => !v);
      }
      // Ctrl+/ or Super+/ — keyboard shortcuts cheatsheet (GNOME-style)
      if ((e.ctrlKey || e.metaKey) && (e.key === "/" || e.key === "?")) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setContextMenu(null);
        setFileMenu(null);
        setWindowSwitcherOpen(false);
        setActivitiesOpen(false);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Terminal icon (dock + launcher) routes through the launch_terminal
  // Tauri command, which tries gnome-terminal → foot → ... so the dock
  // behaves the same whether the user is in their full SalmonApp Wayland
  // session or testing under GNOME.
  const runDesktopAction = useCallback((label: string, action: () => Promise<unknown> | void) => {
    try {
      Promise.resolve(action())
        .then(() => showToast(label))
        .then(() => refreshSystemApps())
        .catch((err) => {
          showToast(`${label}失败`);
          // eslint-disable-next-line no-console
          console.error(label, err);
        });
    } catch (err) {
      showToast(`${label}失败`);
      // eslint-disable-next-line no-console
      console.error(label, err);
    }
  }, [refreshSystemApps, showToast]);

  const launchTerminal = useCallback(() => {
    runDesktopAction("Terminal 已启动", () => api.launchTerminal().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("launch_terminal:", err);
      throw err;
    }));
  }, [runDesktopAction]);
  const launchSystemApp = useCallback((kind: SystemAppKind) => {
    runDesktopAction("应用已启动", () => api.launchSystemApp(kind).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`launch_system_app ${kind}:`, err);
      throw err;
    }));
  }, [runDesktopAction]);

  const createDesktopFolder = useCallback(() => {
    const name = window.prompt("文件夹名称", "新建文件夹");
    if (name === null) return;
    runDesktopAction("文件夹已创建", async () => {
      await api.createDesktopFolder(name);
      refreshDesktopItems();
    });
  }, [refreshDesktopItems, runDesktopAction]);

  const createDesktopFile = useCallback(() => {
    const name = window.prompt("文档名称", "新建文档.txt");
    if (name === null) return;
    runDesktopAction("文档已创建", async () => {
      await api.createDesktopFile(name);
      refreshDesktopItems();
    });
  }, [refreshDesktopItems, runDesktopAction]);

  const renameDesktopItem = useCallback((item: FileEntry) => {
    const name = window.prompt("新名称", item.name);
    if (name === null || name.trim() === item.name) return;
    runDesktopAction("已重命名", async () => {
      await api.renameDesktopItem(item.path, name);
      refreshDesktopItems();
    });
  }, [refreshDesktopItems, runDesktopAction]);

  const trashDesktopItem = useCallback((item: FileEntry) => {
    if (!window.confirm(`移到回收站：${item.name}？`)) return;
    runDesktopAction("已移到回收站", async () => {
      await api.trashPath(item.path);
      refreshDesktopItems();
    });
  }, [refreshDesktopItems, runDesktopAction]);

  const emptyTrash = useCallback(() => {
    if (!window.confirm("清空回收站？此操作无法撤销。")) return;
    runDesktopAction("回收站已清空", () => api.emptyTrash());
  }, [runDesktopAction]);

  const focusWindow = useCallback(async (windowItem: OpenWindowItem) => {
    if (windowItem.kind === "external") {
      if (!windowItem.appId) return;
      if (windowItem.ambiguous) {
        showToast("外部窗口匹配不唯一，请用 Alt-Tab 或标题栏聚焦");
        return;
      }
      await api.focusExternalWindow(windowItem.id ?? "", windowItem.appId, windowItem.title)
        .catch(() => showToast("外部窗口匹配失败"));
      setWindowSwitcherOpen(false);
      return;
    }
    const label = windowItem.label;
    if (!label) return;
    const wins = await getAllWebviewWindows();
    const target = wins.find((w) => w.label === label);
    if (!target) return;
    try { await target.unminimize(); } catch {}
    try { await target.show(); } catch {}
    try { await target.setFocus(); } catch {}
    setWindowSwitcherOpen(false);
  }, [showToast]);

  const minimizeWindow = useCallback(async (windowItem: OpenWindowItem) => {
    if (windowItem.kind === "external") {
      if (!windowItem.appId) return;
      await api.minimizeExternalWindow(windowItem.id ?? "", windowItem.appId, windowItem.title)
        .catch(() => showToast("外部窗口匹配不唯一，请用标题栏最小化"));
      setTimeout(() => { refreshOpenWindows().catch(() => {}); }, 200);
      return;
    }
    const label = windowItem.label;
    if (!label) return;
    const wins = await getAllWebviewWindows();
    const target = wins.find((w) => w.label === label);
    if (!target) return;
    try { await target.minimize(); } catch {}
    refreshOpenWindows().catch(() => {});
  }, [refreshOpenWindows]);

  const maximizeWindow = useCallback(async (windowItem: OpenWindowItem) => {
    if (windowItem.kind === "external") {
      if (!windowItem.appId) return;
      await api.maximizeExternalWindow(windowItem.id ?? "", windowItem.appId, windowItem.title)
        .catch(() => showToast("外部窗口匹配不唯一，请用标题栏最大化"));
      setTimeout(() => { refreshOpenWindows().catch(() => {}); }, 200);
      return;
    }
    const label = windowItem.label;
    if (!label) return;
    const wins = await getAllWebviewWindows();
    const target = wins.find((w) => w.label === label);
    if (!target) return;
    try {
      const maximized = await target.isMaximized();
      if (maximized) await target.unmaximize();
      else await target.maximize();
    } catch {}
    refreshOpenWindows().catch(() => {});
  }, [refreshOpenWindows, showToast]);

  const fullscreenWindow = useCallback(async (windowItem: OpenWindowItem) => {
    if (windowItem.kind === "external") {
      if (!windowItem.appId) return;
      await api.fullscreenExternalWindow(windowItem.id ?? "", windowItem.appId, windowItem.title)
        .catch(() => showToast("外部窗口匹配不唯一，请用标题栏全屏"));
      setTimeout(() => { refreshOpenWindows().catch(() => {}); }, 200);
      return;
    }
    const label = windowItem.label;
    if (!label) return;
    const wins = await getAllWebviewWindows();
    const target = wins.find((w) => w.label === label);
    if (!target) return;
    try {
      const fullscreen = await target.isFullscreen();
      await target.setFullscreen(!fullscreen);
    } catch {}
    refreshOpenWindows().catch(() => {});
  }, [refreshOpenWindows, showToast]);

  const closeWindow = useCallback(async (windowItem: OpenWindowItem) => {
    if (windowItem.kind === "external") {
      if (!windowItem.appId) return;
      await api.closeExternalWindow(windowItem.id ?? "", windowItem.appId, windowItem.title)
        .catch(() => showToast("外部窗口匹配不唯一，请用标题栏关闭"));
      setTimeout(() => { refreshOpenWindows().catch(() => {}); }, 200);
      return;
    }
    const label = windowItem.label;
    if (!label) return;
    const wins = await getAllWebviewWindows();
    const target = wins.find((w) => w.label === label);
    if (!target) return;
    try { await target.close(); } catch {}
    setTimeout(() => { refreshOpenWindows().catch(() => {}); }, 200);
  }, [refreshOpenWindows, showToast]);

  const focusOrOpen = useCallback(async (label: string, fallback: () => void) => {
    const rows = await refreshOpenWindows().catch(() => []);
    const target = rows.find((w) => w.label === label);
    if (target) {
      await focusWindow(target);
      return;
    }
    fallback();
  }, [focusWindow, refreshOpenWindows]);

  const onDesktopContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest(".dock, .topbar, .launcher, .ai-anchor, .widget, .desktop-context-menu, .desktop-file-menu, .desktop-appearance-panel, .window-switcher, .window-strip, .activities-overview, .welcome-overlay, .shortcuts-overlay")) {
      return;
    }
    e.preventDefault();
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 290),
    });
  }, []);

  const callbacks: WidgetCallbacks = {
    onNavigateMail: navigate.mail,
    onNavigateCalendar: navigate.calendar,
    onNavigateTasks: navigate.tasks,
    onNavigateHome: navigate.home,
  };

  const runningLabels = new Set(openWindows.map((w) => w.label).filter(Boolean));
  const wallpaperImageSrc = wallpaperImagePath ? convertFileSrc(wallpaperImagePath) : null;
  const windowInitial = (title: string) => title.trim().slice(0, 1).toUpperCase() || "W";
  const parentPath = (path: string) => {
    const i = path.lastIndexOf("/");
    return i > 0 ? path.slice(0, i) : "/";
  };

  const aiTile = (
    <AILiveTile
      snap={brief}
      callbacks={callbacks}
      badgeCount={count}
      onClick={(e) => {
        e.stopPropagation();
        setAiOpen((v) => !v);
        setAiHover(false);
      }}
      onHoverChange={(h) => setAiHover(h)}
      peek={<AIPeek show={aiHover && !aiOpen} snap={brief} callbacks={callbacks} />}
      pop={
        <AIPopover
          show={aiOpen}
          snap={brief}
          callbacks={callbacks}
          onClose={() => setAiOpen(false)}
          onExpand={() => {
            setAiOpen(false);
            setManualMode("expanded");
          }}
        />
      }
    />
  );

  // Cycle wallpaper from a keyboard shortcut hint — but we don't use this in
  // user-facing copy; keeps the function reference live for the topbar.
  void cycleWallpaper;

  return (
    <div
      className={`dt-shell theme-${desktopTheme} accent-${desktopAccent}`}
      data-mode="desktop"
      onContextMenu={onDesktopContextMenu}
      onPointerDown={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest(".desktop-context-menu")) setContextMenu(null);
        if (!target?.closest(".desktop-file-menu")) setFileMenu(null);
        if (!target?.closest(".desktop-appearance-panel")) setAppearanceOpen(false);
      }}
    >
      <Wallpaper variant={wallpaper} imageSrc={wallpaperImageSrc} fit={wallpaperFit} />

      <TopBar
        briefCount={count}
        brief={brief}
        onActivities={() => setActivitiesOpen(true)}
        onNavigateMail={navigate.mail}
        onNavigateCalendar={navigate.calendar}
        onNavigateTasks={navigate.tasks}
        onNavigateHome={navigate.home}
        onOpenSettings={navigate.settings}
        onCycleWallpaper={cycleWallpaper}
        onExitDesktop={props.onExitDesktop}
      />

      <div
        className="stage"
        style={{
          opacity: showCenterWidget ? 1 : 0,
          transform: showCenterWidget ? "scale(1) translateY(0)" : "scale(0.97) translateY(8px)",
          transition:
            "opacity 200ms cubic-bezier(0.2,0.8,0.2,1), transform 240ms cubic-bezier(0.2,0.8,0.2,1)",
          pointerEvents: showCenterWidget ? "auto" : "none",
        }}
      >
        <Widget
          mode={widgetMode}
          snap={brief}
          onModeChange={(m) => setManualMode(m)}
          callbacks={callbacks}
        />
      </div>

      <div className="desktop-icons" aria-label="Desktop files">
        {desktopItems.map((item) => {
          const Icon = item.isDir ? Icons.Folder : Icons.Doc;
          return (
            <button
              key={item.path}
              type="button"
              className="desktop-file"
              title={item.path}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu(null);
                setFileMenu({
                  x: Math.min(e.clientX, window.innerWidth - 230),
                  y: Math.min(e.clientY, window.innerHeight - 210),
                  item,
                });
              }}
              onDoubleClick={() => {
                api.openPath(item.path).catch(() => showToast("打开失败"));
              }}
            >
              <span className={`desktop-file-icon${item.isDir ? " is-folder" : ""}`}>
                <Icon />
              </span>
              <span className="desktop-file-name">{item.name}</span>
            </button>
          );
        })}
      </div>

      {openWindows.length > 0 && (
        <div className="window-strip" aria-label="Open windows">
          {openWindows.map((w) => (
            <div key={w.key} className={`window-chip${w.kind === "external" ? " external" : ""}`}>
              <button
                type="button"
                className="window-chip-main"
                title={w.ambiguous ? "同名外部窗口不唯一，请用 Alt-Tab 或标题栏聚焦" : w.title}
                disabled={w.kind === "external" && w.ambiguous}
                onClick={() => focusWindow(w)}
              >
                <span className="win-glyph">{windowInitial(w.title)}</span>
                <span>{w.title}{w.ambiguous ? " · 多窗口" : ""}</span>
              </button>
              <button
                type="button"
                className="window-chip-action"
                title={w.ambiguous ? "同名外部窗口不唯一，请用标题栏最小化" : "最小化"}
                disabled={w.kind === "external" && w.ambiguous}
                onClick={() => minimizeWindow(w)}
              >
                _
              </button>
              <button
                type="button"
                className="window-chip-action"
                title={w.ambiguous ? "同名外部窗口不唯一，请用标题栏最大化" : "最大化"}
                disabled={w.kind === "external" && w.ambiguous}
                onClick={() => maximizeWindow(w)}
              >
                □
              </button>
              <button
                type="button"
                className="window-chip-action"
                title={w.ambiguous ? "同名外部窗口不唯一，请用标题栏全屏" : "全屏"}
                disabled={w.kind === "external" && w.ambiguous}
                onClick={() => fullscreenWindow(w)}
              >
                ⛶
              </button>
              <button
                type="button"
                className="window-chip-action"
                title={w.ambiguous ? "同名外部窗口不唯一，请用标题栏关闭" : "关闭"}
                disabled={w.kind === "external" && w.ambiguous}
                onClick={() => closeWindow(w)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <Dock
        aiTile={aiTile}
        unreadMail={brief.unreadMail}
        hasNextEvent={brief.nextEvent !== null}
        todayTasksCount={brief.todayTasks.length}
        onLauncher={() => setLauncherOpen(true)}
        mailRunning={runningLabels.has("app-mail")}
        calendarRunning={runningLabels.has("app-calendar")}
        tasksRunning={runningLabels.has("app-tasks")}
        homeRunning={runningLabels.has("app-home")}
        settingsRunning={runningLabels.has("app-settings") || systemAppStatus.settingsRunning}
        filesRunning={systemAppStatus.filesRunning}
        browserRunning={systemAppStatus.browserRunning}
        terminalRunning={systemAppStatus.terminalRunning}
        windowCount={openWindows.length}
        onNavigateMail={() => focusOrOpen("app-mail", navigate.mail)}
        onNavigateCalendar={() => focusOrOpen("app-calendar", navigate.calendar)}
        onNavigateTasks={() => focusOrOpen("app-tasks", navigate.tasks)}
        onNavigateHome={() => focusOrOpen("app-home", navigate.home)}
        onOpenSettings={navigate.settings}
        onLaunchTerminal={launchTerminal}
        onLaunchFiles={() => launchSystemApp("files")}
        onLaunchBrowser={() => launchSystemApp("browser")}
        onLaunchSystemSettings={() => launchSystemApp("settings")}
      />

      {launcherOpen && (
        <Launcher
          onClose={() => setLauncherOpen(false)}
          onNavigateMail={navigate.mail}
          onNavigateCalendar={navigate.calendar}
          onNavigateTasks={navigate.tasks}
          onNavigateHome={navigate.home}
          onNavigateContacts={navigate.contacts}
          onNewTopic={props.onNewTopic}
          onOpenSearch={props.onOpenSearch}
          onOpenSettings={navigate.settings}
          onLaunchTerminal={launchTerminal}
          onLaunchFiles={() => launchSystemApp("files")}
          onLaunchBrowser={() => launchSystemApp("browser")}
        />
      )}

      {contextMenu && (
        <div
          className="desktop-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { setContextMenu(null); setLauncherOpen(true); }}>打开应用</button>
          <button type="button" onClick={() => { setContextMenu(null); props.onNewTopic(); }}>新建 Topic</button>
          <button type="button" onClick={() => { setContextMenu(null); createDesktopFolder(); }}>新建文件夹</button>
          <button type="button" onClick={() => { setContextMenu(null); createDesktopFile(); }}>新建文档</button>
          <button type="button" onClick={() => { setContextMenu(null); launchSystemApp("files"); }}>打开文件</button>
          <button type="button" onClick={() => { setContextMenu(null); launchTerminal(); }}>打开终端</button>
          <div className="context-sep" />
          <button type="button" onClick={() => { setContextMenu(null); refreshDesktopItems(); showToast("桌面已刷新"); }}>刷新桌面</button>
          <button type="button" onClick={() => { setContextMenu(null); cycleWallpaper(); }}>切换壁纸</button>
          <button type="button" onClick={() => { setContextMenu(null); setAppearanceOpen(true); }}>桌面外观</button>
          <button type="button" onClick={() => { setContextMenu(null); navigate.settings(); }}>Salmon 设置</button>
          <div className="context-sep" />
          <button type="button" onClick={() => { setContextMenu(null); api.openTrash().catch(() => showToast("打开回收站失败")); }}>打开回收站</button>
          <button type="button" onClick={() => { setContextMenu(null); emptyTrash(); }}>清空回收站</button>
          <div className="context-sep" />
          <button type="button" onClick={() => { setContextMenu(null); api.sessionAction("lock").catch(() => showToast("锁屏失败")); }}>锁屏</button>
          <button type="button" onClick={() => { setContextMenu(null); api.sessionAction("signout").catch(() => showToast("退出失败")); }}>退出会话</button>
        </div>
      )}

      {appearanceOpen && (
        <div className="desktop-appearance-panel" onClick={(e) => e.stopPropagation()}>
          <div className="appearance-head">
            <div>
              <div className="appearance-title">桌面外观</div>
              <div className="appearance-sub">壁纸、主题、字体、强调色</div>
            </div>
            <button type="button" aria-label="关闭" onClick={() => setAppearanceOpen(false)}>×</button>
          </div>
          <div className="wallpaper-choices">
            {wallpaperImageSrc && (
              <button
                type="button"
                className="wallpaper-choice is-active"
                onClick={chooseWallpaperImage}
              >
                <span className="wallpaper-preview wp-image" style={{ backgroundImage: `url("${wallpaperImageSrc}")` }} />
                <span className="wallpaper-choice-label">当前图片</span>
              </button>
            )}
            {WALLPAPER_VARIANTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`wallpaper-choice${wallpaper === item.id ? " is-active" : ""}`}
                onClick={() => chooseWallpaper(item.id)}
              >
                <span className={`wallpaper-preview wp-${item.id}`} />
                <span className="wallpaper-choice-label">{item.label}</span>
              </button>
            ))}
            <button type="button" className="wallpaper-choice wallpaper-file-choice" onClick={chooseWallpaperImage}>
              <span className="wallpaper-preview wallpaper-file-preview">+</span>
              <span className="wallpaper-choice-label">选择图片</span>
            </button>
          </div>
          <div className="appearance-section">
            <div className="appearance-section-title">图片填充</div>
            <div className="appearance-segment">
              {WALLPAPER_FITS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={wallpaperFit === item.id ? "is-active" : ""}
                  onClick={() => chooseWallpaperFit(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="appearance-section">
            <div className="appearance-section-title">自动轮换</div>
            <div className="appearance-segment">
              {WALLPAPER_SLIDESHOWS.map((item) => (
                <button
                  key={item.minutes}
                  type="button"
                  className={wallpaperSlideshowMinutes === item.minutes ? "is-active" : ""}
                  onClick={() => chooseWallpaperSlideshow(item.minutes)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="appearance-section">
            <div className="appearance-section-title">主题</div>
            <div className="appearance-segment">
              {DESKTOP_THEMES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={desktopTheme === item.id ? "is-active" : ""}
                  onClick={() => chooseDesktopTheme(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {(gtkThemes.length > 0 || iconThemes.length > 0 || cursorThemes.length > 0) && (
            <div className="appearance-section">
              <div className="appearance-section-title">系统样式</div>
              <div className="appearance-select-grid">
                {gtkThemes.length > 0 && (
                  <label>
                    <span>应用</span>
                    <select value={gtkTheme} onChange={(e) => chooseGtkTheme(e.currentTarget.value)}>
                      {gtkThemes.map((theme) => (
                        <option key={theme} value={theme}>{theme}</option>
                      ))}
                    </select>
                  </label>
                )}
                {iconThemes.length > 0 && (
                  <label>
                    <span>图标</span>
                    <select value={iconTheme} onChange={(e) => chooseIconTheme(e.currentTarget.value)}>
                      {iconThemes.map((theme) => (
                        <option key={theme} value={theme}>{theme}</option>
                      ))}
                    </select>
                  </label>
                )}
                {cursorThemes.length > 0 && (
                  <label>
                    <span>光标</span>
                    <select value={cursorTheme} onChange={(e) => chooseCursorTheme(e.currentTarget.value)}>
                      {cursorThemes.map((theme) => (
                        <option key={theme} value={theme}>{theme}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          )}
          {(fontFamilies.length > 0 || monospaceFontFamilies.length > 0) && (
            <div className="appearance-section">
              <div className="appearance-section-title">系统字体</div>
              <div className="appearance-select-grid">
                {fontFamilies.length > 0 && (
                  <label>
                    <span>界面</span>
                    <select value={interfaceFontFamily} onChange={(e) => chooseFontFamily("interface", e.currentTarget.value)}>
                      {fontFamilies.map((family) => (
                        <option key={family} value={family}>{family}</option>
                      ))}
                    </select>
                  </label>
                )}
                {fontFamilies.length > 0 && (
                  <label>
                    <span>文档</span>
                    <select value={documentFontFamily} onChange={(e) => chooseFontFamily("document", e.currentTarget.value)}>
                      {fontFamilies.map((family) => (
                        <option key={family} value={family}>{family}</option>
                      ))}
                    </select>
                  </label>
                )}
                {monospaceFontFamilies.length > 0 && (
                  <label>
                    <span>等宽</span>
                    <select value={monospaceFontFamily} onChange={(e) => chooseFontFamily("monospace", e.currentTarget.value)}>
                      {monospaceFontFamilies.map((family) => (
                        <option key={family} value={family}>{family}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="appearance-segment appearance-scale">
                {TEXT_SCALE_OPTIONS.map((item) => (
                  <button
                    key={item.factor}
                    type="button"
                    className={Math.abs(textScalingFactor - item.factor) < 0.01 ? "is-active" : ""}
                    onClick={() => chooseTextScalingFactor(item.factor)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="appearance-section">
            <div className="appearance-section-title">强调色</div>
            <div className="appearance-swatches">
              {DESKTOP_ACCENTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`accent-swatch swatch-${item.id}${desktopAccent === item.id ? " is-active" : ""}`}
                  onClick={() => chooseDesktopAccent(item.id)}
                >
                  <span />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {fileMenu && (
        <div
          className="desktop-file-menu"
          style={{ left: fileMenu.x, top: fileMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="file-menu-title">{fileMenu.item.name}</div>
          <button
            type="button"
            onClick={() => {
              const item = fileMenu.item;
              setFileMenu(null);
              api.openPath(item.path).catch(() => showToast("打开失败"));
            }}
          >
            打开
          </button>
          <button
            type="button"
            onClick={() => {
              const item = fileMenu.item;
              setFileMenu(null);
              api.openPath(parentPath(item.path)).catch(() => showToast("打开失败"));
            }}
          >
            打开所在文件夹
          </button>
          <button
            type="button"
            onClick={() => {
              const path = fileMenu.item.path;
              setFileMenu(null);
              const copyPath = navigator.clipboard?.writeText(path);
              if (!copyPath) {
                showToast("复制失败");
                return;
              }
              copyPath.then(() => showToast("路径已复制")).catch(() => showToast("复制失败"));
            }}
          >
            复制路径
          </button>
          <button
            type="button"
            onClick={() => {
              const item = fileMenu.item;
              setFileMenu(null);
              renameDesktopItem(item);
            }}
          >
            重命名
          </button>
          <button
            type="button"
            onClick={() => {
              const item = fileMenu.item;
              setFileMenu(null);
              trashDesktopItem(item);
            }}
          >
            移到回收站
          </button>
          <div className="context-sep" />
          <button type="button" onClick={() => { setFileMenu(null); refreshDesktopItems(); }}>刷新桌面</button>
        </div>
      )}

      {windowSwitcherOpen && (
        <div className="window-switcher" onClick={() => setWindowSwitcherOpen(false)}>
          <div className="window-switcher-panel" onClick={(e) => e.stopPropagation()}>
            {openWindows.length === 0 ? (
              <div className="window-switcher-empty">没有打开的窗口</div>
            ) : openWindows.map((w) => (
              <button key={w.key} type="button" onClick={() => focusWindow(w)}>
                <span className="win-glyph">{windowInitial(w.title)}</span>
                <span>{w.title}{w.ambiguous ? " · 多窗口" : ""}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ActivitiesOverview
        open={activitiesOpen}
        onClose={() => setActivitiesOpen(false)}
        windows={openWindows}
        onFocusWindow={focusWindow}
        onCloseWindow={closeWindow}
        workspaces={overviewWorkspaces}
        onSwitchWorkspace={(idx) => {
          api.switchWorkspace(idx).catch(() => showToast("切换工作区失败"));
          setActivitiesOpen(false);
        }}
        onSearch={(q) => {
          if (q) {
            // Launcher has live filtering — opening it after the user
            // typed a query effectively pre-seeds search via paste.
            props.onOpenSearch(q);
          } else {
            setLauncherOpen(true);
          }
        }}
      />


      {desktopToast && <div className="desktop-toast">{desktopToast}</div>}

      <WelcomeOverlay
        open={welcomeOpen}
        onClose={() => {
          try { localStorage.setItem(WELCOME_STORAGE_KEY, String(Date.now())); } catch {}
          setWelcomeOpen(false);
        }}
      />

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
