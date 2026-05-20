// GNOME-style top bar: Activities (left) · clock (center, with Brief badge) · tray (right).
// `briefCount` is the real number of pending Brief items from useDesktopBrief.
import { type DragEvent, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../../lib/api";
import type { SystemAppKind } from "../../lib/api";
import type { BriefSnapshot } from "../../lib/useDesktopBrief";
import { Icons } from "./Icons";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface Props {
  briefCount: number;
  brief?: BriefSnapshot;
  onActivities: () => void;
  onNavigateMail?: () => void;
  onNavigateCalendar?: () => void;
  onNavigateTasks?: () => void;
  onNavigateHome?: () => void;
  onOpenSettings: () => void;
  onCycleWallpaper: () => void;
  /** Exit the desktop shell back to the normal app home — kept so the
   *  user can always get back to WelcomeBack without a Settings hunt. */
  onExitDesktop?: () => void;
}

interface DesktopStatus {
  networkLabel: string;
  volumeLabel: string;
  batteryLabel: string;
  brightnessLabel: string;
  bluetoothLabel: string;
  inputLabel: string;
  hasNetwork: boolean;
  hasBluetooth: boolean;
  muted: boolean;
  charging: boolean;
}

interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
  active: boolean;
}

interface BluetoothDevice {
  address: string;
  name: string;
  connected: boolean;
  paired: boolean;
  trusted: boolean;
}

interface AudioOutputDevice {
  id: string;
  name: string;
  active: boolean;
  volume: string;
}

interface AudioInputDevice {
  id: string;
  name: string;
  active: boolean;
  volume: string;
}

interface InputMethodEngine {
  id: string;
  name: string;
  framework: string;
  active: boolean;
}

interface ClipboardHistoryItem {
  id: string;
  preview: string;
  kind: string;
}

interface WorkspaceInfo {
  index: number;
  name: string;
  active: boolean;
}

interface DisplayOutput {
  name: string;
  description: string;
  enabled: boolean;
  currentMode: string;
  scale: string;
  transform: string;
  position: string;
  modes: string[];
}

interface DisplayProfile {
  name: string;
  outputCount: number;
  enabledCount: number;
}

interface PrinterStatus {
  name: string;
  state: string;
  enabled: boolean;
  isDefault: boolean;
  queuedJobs: number;
}

interface VpnStatus {
  available: boolean;
  configuredCount: number;
  connections: { name: string; active: boolean; device: string | null }[];
  activeConnections: { name: string; active: boolean; device: string | null }[];
}

interface AccessibilityStatus {
  available: boolean;
  screenReader: boolean;
  highContrast: boolean;
  stickyKeys: boolean;
  slowKeys: boolean;
  reduceMotion: boolean;
}

interface NightLightStatus {
  available: boolean;
  enabled: boolean;
  temperature: number;
}

interface NotificationStatus {
  available: boolean;
  daemon: string;
  doNotDisturb: boolean;
}

type AccessibilityFeature = "screen-reader" | "high-contrast" | "sticky-keys" | "slow-keys" | "reduce-motion";

const ACCESSIBILITY_FEATURES: {
  id: AccessibilityFeature;
  label: string;
  description: string;
  field: keyof Omit<AccessibilityStatus, "available">;
}[] = [
  { id: "screen-reader", label: "屏幕阅读器", description: "启用 Orca/系统阅读器", field: "screenReader" },
  { id: "high-contrast", label: "高对比度", description: "切换系统高对比度主题", field: "highContrast" },
  { id: "sticky-keys", label: "粘滞键", description: "按键组合可逐个输入", field: "stickyKeys" },
  { id: "slow-keys", label: "慢速键", description: "忽略短促误触按键", field: "slowKeys" },
  { id: "reduce-motion", label: "减少动画", description: "降低系统界面动画", field: "reduceMotion" },
];

interface PowerStatus {
  acOnline: boolean;
  batteries: {
    name: string;
    percentage: number | null;
    status: string;
    energyNow: number | null;
    energyFull: number | null;
    powerNow: number | null;
    timeRemainingMinutes: number | null;
  }[];
  powerProfiles: {
    available: boolean;
    active: PowerProfileId | null;
    profiles: { id: PowerProfileId; active: boolean }[];
  };
}

type PowerProfileId = "power-saver" | "balanced" | "performance";

type DesktopControlAction =
  | "volume-up"
  | "volume-down"
  | "volume-mute"
  | "mic-mute"
  | "brightness-up"
  | "brightness-down"
  | "input-toggle"
  | "wifi-toggle"
  | "bluetooth-toggle";

const POWER_PROFILES: { id: PowerProfileId; label: string }[] = [
  { id: "power-saver", label: "节能" },
  { id: "balanced", label: "平衡" },
  { id: "performance", label: "性能" },
];

interface StorageVolume {
  name: string;
  path: string;
  label: string;
  size: string;
  fsType: string;
  removable: boolean;
  mounted: boolean;
  mountpoints: string[];
}

interface NotificationRow {
  id: string;
  kind: "mail" | "calendar" | "task" | "ai";
  title: string;
  meta: string;
  action: string;
  onClick: () => void;
}

const DEFAULT_STATUS: DesktopStatus = {
  networkLabel: "Network",
  volumeLabel: "Volume",
  batteryLabel: "Battery",
  brightnessLabel: "Brightness",
  bluetoothLabel: "Bluetooth",
  inputLabel: "EN",
  hasNetwork: false,
  hasBluetooth: false,
  muted: false,
  charging: false,
};

const DISPLAY_SCALE_OPTIONS = ["1", "1.25", "1.5", "1.75", "2", "2.5", "3"];
const DISPLAY_TRANSFORM_OPTIONS = [
  { value: "normal", label: "正常" },
  { value: "90", label: "90°" },
  { value: "180", label: "180°" },
  { value: "270", label: "270°" },
  { value: "flipped", label: "翻转" },
  { value: "flipped-90", label: "翻转 90°" },
  { value: "flipped-180", label: "翻转 180°" },
  { value: "flipped-270", label: "翻转 270°" },
];

interface DisplayLayoutTile extends DisplayOutput {
  x: number;
  y: number;
  width: number;
  height: number;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

function parseOutputPosition(position: string) {
  const [xRaw, yRaw] = position.split(",");
  const x = Number.parseInt(xRaw ?? "0", 10);
  const y = Number.parseInt(yRaw ?? "0", 10);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

function parseOutputSize(mode: string) {
  const match = mode.match(/(\d+)x(\d+)/);
  if (!match) return { width: 1280, height: 720 };
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1280,
    height: Number.isFinite(height) && height > 0 ? height : 720,
  };
}

function buildDisplayLayout(outputs: DisplayOutput[]) {
  const rawTiles = outputs.filter((output) => output.enabled).map((output) => {
    const position = parseOutputPosition(output.position);
    const size = parseOutputSize(output.currentMode);
    return { ...output, ...position, ...size };
  });
  if (rawTiles.length === 0) {
    return { tiles: [] as DisplayLayoutTile[], minX: 0, minY: 0, width: 1, height: 1 };
  }
  const minX = Math.min(...rawTiles.map((tile) => tile.x));
  const minY = Math.min(...rawTiles.map((tile) => tile.y));
  const maxX = Math.max(...rawTiles.map((tile) => tile.x + tile.width));
  const maxY = Math.max(...rawTiles.map((tile) => tile.y + tile.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const tiles = rawTiles.map((tile) => ({
    ...tile,
    leftPct: ((tile.x - minX) / width) * 100,
    topPct: ((tile.y - minY) / height) * 100,
    widthPct: Math.max(12, (tile.width / width) * 100),
    heightPct: Math.max(18, (tile.height / height) * 100),
  }));
  return { tiles, minX, minY, width, height };
}

function quantizeOutputPosition(value: number) {
  return Math.round(value / 50) * 50;
}

function formatBatteryTime(minutes: number | null) {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}

function buildCalendarCells(now: Date) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      day: date.getDate(),
      currentMonth: date.getMonth() === month,
      today: dayStart.getTime() === today.getTime(),
    };
  });
}

function formatEventTime(ms: number) {
  return new Date(ms).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function canUnmountStorageVolume(volume: StorageVolume) {
  return volume.removable || volume.mountpoints.some((path) => (
    path === "/mnt" || path.startsWith("/mnt/") || path.startsWith("/media/") || path.startsWith("/run/media/")
  ));
}

function formatClockTime(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function buildNotificationRows(
  brief: BriefSnapshot | undefined,
  fallbackCount: number,
  actions: {
    mail: () => void;
    calendar: () => void;
    tasks: () => void;
    home: () => void;
  },
): NotificationRow[] {
  if (!brief) {
    return fallbackCount > 0 ? [{
      id: `brief:${fallbackCount}`,
      kind: "ai",
      title: "Salmon Brief",
      meta: `${fallbackCount} 项需要处理`,
      action: "查看",
      onClick: actions.home,
    }] : [];
  }
  const rows: NotificationRow[] = [];
  if (brief.nextEvent) {
    rows.push({
      id: `event:${brief.nextEvent.accountId ?? ""}:${brief.nextEvent.id}`,
      kind: "calendar",
      title: brief.nextEvent.title || "(无标题会议)",
      meta: `${formatClockTime(brief.nextEvent.startMs)} 开始${brief.nextEvent.location ? ` · ${brief.nextEvent.location}` : ""}`,
      action: "日历",
      onClick: actions.calendar,
    });
  }
  brief.recentMail.forEach((mail) => {
    rows.push({
      id: `mail:${mail.accountId}:${mail.id}`,
      kind: "mail",
      title: mail.subject || "(无主题)",
      meta: mail.fromName || mail.fromEmail || "未读邮件",
      action: "邮件",
      onClick: actions.mail,
    });
  });
  if (brief.recentMail.length === 0 && brief.unreadMail > 0) {
    rows.push({
      id: `mail-unread:${brief.unreadMail}`,
      kind: "mail",
      title: "未读邮件",
      meta: `${brief.unreadMail} 封未读`,
      action: "邮件",
      onClick: actions.mail,
    });
  }
  brief.todayTasks.forEach((task) => {
    rows.push({
      id: `task:${task.accountId ?? ""}:${task.id}`,
      kind: "task",
      title: task.title,
      meta: task.dueMs ? `${task.dueMs < Date.now() ? "逾期" : "截止"} ${formatClockTime(task.dueMs)}` : "今日待办",
      action: "任务",
      onClick: actions.tasks,
    });
  });
  brief.recs.forEach((rec) => {
    rows.push({
      id: `rec:${rec.id}`,
      kind: "ai",
      title: rec.title,
      meta: rec.priority === "high" ? "重要 AI 建议" : (rec.actionHint || "AI 建议"),
      action: "查看",
      onClick: actions.home,
    });
  });
  return rows;
}

function useDesktopStatus() {
  const [status, setStatus] = useState<DesktopStatus>(DEFAULT_STATUS);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      api.getDesktopStatus()
        .then((s) => { if (alive) setStatus(s); })
        .catch(() => {});
    };
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return [status, setStatus] as const;
}

/** When the desktop binary is running as the labwc session shell
 *  (label="shell"), the exit button signs out of the Wayland session and
 *  returns to GDM — closing the window alone is not enough because
 *  labwc-config/autostart respawns salmonapp-desktop in a tight loop. In the
 *  App binary the desktop view is just a togglable in-app screen, so we fall
 *  back to the in-app switch via `onExitDesktop`. */
async function exitDesktopShell(fallback?: () => void) {
  try {
    const w = getCurrentWindow();
    if (w.label === "shell") {
      try {
        await api.signOutSession();
        return;
      } catch {
        // logind refused — fall through to close so the user isn't trapped.
      }
      try { await w.setFullscreen(false); } catch {}
      try { await w.close(); return; } catch {}
    }
  } catch {}
  fallback?.();
}

const NOTIFICATION_DISMISS_KEY = "salmon.desktop.dismissedNotifications";

export function TopBar({
  briefCount,
  brief,
  onActivities,
  onNavigateMail,
  onNavigateCalendar,
  onNavigateTasks,
  onNavigateHome,
  onOpenSettings,
  onCycleWallpaper,
  onExitDesktop,
}: Props) {
  const now = useClock();
  const [status, setStatus] = useDesktopStatus();
  const [panel, setPanel] = useState<"calendar" | "quick" | "notifications" | null>(null);
  const [dismissedSignature, setDismissedSignature] = useState(() => {
    try {
      return localStorage.getItem(NOTIFICATION_DISMISS_KEY) || "";
    } catch {
      return "";
    }
  });
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>([]);
  const [wifiMessage, setWifiMessage] = useState<string | null>(null);
  const [bluetoothDevices, setBluetoothDevices] = useState<BluetoothDevice[]>([]);
  const [bluetoothMessage, setBluetoothMessage] = useState<string | null>(null);
  const [audioOutputs, setAudioOutputs] = useState<AudioOutputDevice[]>([]);
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [inputMethods, setInputMethods] = useState<InputMethodEngine[]>([]);
  const [clipboardItems, setClipboardItems] = useState<ClipboardHistoryItem[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [audioOutputMessage, setAudioOutputMessage] = useState<string | null>(null);
  const [audioInputMessage, setAudioInputMessage] = useState<string | null>(null);
  const [inputMethodMessage, setInputMethodMessage] = useState<string | null>(null);
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [screenshotMessage, setScreenshotMessage] = useState<string | null>(null);
  const [displayOutputs, setDisplayOutputs] = useState<DisplayOutput[]>([]);
  const [displayProfiles, setDisplayProfiles] = useState<DisplayProfile[]>([]);
  const [printers, setPrinters] = useState<PrinterStatus[]>([]);
  const [vpnStatus, setVpnStatus] = useState<VpnStatus>({
    available: false,
    configuredCount: 0,
    connections: [],
    activeConnections: [],
  });
  const [powerStatus, setPowerStatus] = useState<PowerStatus>({
    acOnline: true,
    batteries: [],
    powerProfiles: { available: false, active: null, profiles: [] },
  });
  const [storageVolumes, setStorageVolumes] = useState<StorageVolume[]>([]);
  const [accessibilityStatus, setAccessibilityStatus] = useState<AccessibilityStatus>({
    available: false,
    screenReader: false,
    highContrast: false,
    stickyKeys: false,
    slowKeys: false,
    reduceMotion: false,
  });
  const [nightLightStatus, setNightLightStatus] = useState<NightLightStatus>({
    available: false,
    enabled: false,
    temperature: 4500,
  });
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>({
    available: false,
    daemon: "none",
    doNotDisturb: false,
  });
  const [displayMessage, setDisplayMessage] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [vpnMessage, setVpnMessage] = useState<string | null>(null);
  const [accessibilityMessage, setAccessibilityMessage] = useState<string | null>(null);
  const [printerMessage, setPrinterMessage] = useState<string | null>(null);
  const [nightLightMessage, setNightLightMessage] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [powerMessage, setPowerMessage] = useState<string | null>(null);
  const [systemMessage, setSystemMessage] = useState<string | null>(null);
  const displayLayout = useMemo(() => buildDisplayLayout(displayOutputs), [displayOutputs]);
  const notificationActions = useMemo(() => ({
    mail: onNavigateMail ?? onActivities,
    calendar: onNavigateCalendar ?? onActivities,
    tasks: onNavigateTasks ?? onActivities,
    home: onNavigateHome ?? onActivities,
  }), [onActivities, onNavigateCalendar, onNavigateHome, onNavigateMail, onNavigateTasks]);
  const notificationRows = useMemo(
    () => buildNotificationRows(brief, briefCount, notificationActions),
    [brief, briefCount, notificationActions],
  );
  const notificationSignature = notificationRows.map((row) => row.id).join("|");
  const notificationsDismissed = notificationSignature.length > 0 && dismissedSignature === notificationSignature;
  const visibleNotifications = notificationsDismissed ? [] : notificationRows;
  const wd = WEEKDAYS[now.getDay()];
  const date = `${now.getMonth() + 1}月${now.getDate()}日`;
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });
  const fullDate = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const calendarMonth = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
  const calendarCells = useMemo(() => buildCalendarCells(now), [now]);
  const nextEventLabel = brief?.nextEvent
    ? `${formatEventTime(brief.nextEvent.startMs)} ${brief.nextEvent.title}`
    : "未来 24 小时暂无日程";
  const runSessionAction = (action: "lock" | "suspend" | "reboot" | "poweroff" | "signout") => {
    if (action === "signout") {
      setPanel(null);
      exitDesktopShell(onExitDesktop);
      return;
    }
    setPowerMessage(action === "lock" ? "正在锁屏" : "正在执行电源操作");
    api.sessionAction(action)
      .then(() => setPowerMessage(action === "lock" ? "锁屏命令已发送" : "电源操作已发送"))
      .catch(() => setPowerMessage(action === "lock" ? "锁屏失败" : "电源操作失败"));
  };
  const launchSystemApp = (kind: SystemAppKind, label = "系统设置") => {
    setSystemMessage(null);
    api.launchSystemApp(kind)
      .then(() => {
        if (panel === "quick") setSystemMessage(`${label}已打开`);
      })
      .catch(() => {
        setSystemMessage(`无法打开${label}`);
        setPanel("quick");
      });
  };
  const setDesktopControlMessage = (action: DesktopControlAction, message: string) => {
    if (action === "wifi-toggle") {
      setWifiMessage(message);
    } else if (action === "bluetooth-toggle") {
      setBluetoothMessage(message);
    } else if (action === "input-toggle") {
      setInputMethodMessage(message);
    } else if (action === "mic-mute") {
      setAudioInputMessage(message);
    } else if (action.startsWith("volume-")) {
      setAudioOutputMessage(message);
    } else if (action.startsWith("brightness-")) {
      setSystemMessage(message);
    }
  };
  const runDesktopControl = (action: DesktopControlAction) => {
    setDesktopControlMessage(action, "正在更新");
    api.desktopControl(action)
      .then(() => api.getDesktopStatus())
      .then((next) => {
        setStatus(next);
        setDesktopControlMessage(action, "已更新");
      })
      .catch(() => setDesktopControlMessage(action, "更新失败"));
  };
  const refreshDisplayOutputs = () => {
    api.listDisplayOutputs().then(setDisplayOutputs).catch(() => {
      setDisplayOutputs([]);
      setDisplayMessage("读取显示器失败");
    });
    api.listDisplayProfiles().then(setDisplayProfiles).catch(() => {
      setDisplayProfiles([]);
      setDisplayMessage("读取显示布局失败");
    });
  };
  const refreshWifiNetworks = (rescan = false) => {
    api.listWifiNetworks(rescan)
      .then((items) => {
        setWifiNetworks(items);
        setWifiMessage(items.length === 0 ? "未读取到 Wi-Fi 网络" : null);
      })
      .catch(() => {
        setWifiNetworks([]);
        setWifiMessage("读取 Wi-Fi 网络失败");
      });
  };
  const connectWifiNetwork = (network: WifiNetwork) => {
    let password: string | null = null;
    if (network.security && !network.active) {
      password = window.prompt(`输入 ${network.ssid} 的 Wi-Fi 密码`) ?? null;
      if (password === null) return;
    }
    api.connectWifiNetwork(network.ssid, password)
      .then(() => {
        setWifiMessage("正在连接 Wi-Fi");
        setTimeout(() => {
          refreshWifiNetworks(false);
          api.getDesktopStatus().then(setStatus).catch(() => {});
        }, 1200);
      })
      .catch(() => setWifiMessage("连接 Wi-Fi 失败"));
  };
  const refreshBluetoothDevices = () => {
    api.listBluetoothDevices()
      .then((items) => {
        setBluetoothDevices(items);
        setBluetoothMessage(items.length === 0 ? "未发现已知蓝牙设备" : null);
      })
      .catch(() => {
        setBluetoothDevices([]);
        setBluetoothMessage("读取蓝牙设备失败");
      });
  };
  const setBluetoothDeviceConnected = (device: BluetoothDevice) => {
    api.setBluetoothDeviceConnected(device.address, !device.connected)
      .then(() => {
        setBluetoothMessage(device.connected ? "正在断开蓝牙设备" : "正在连接蓝牙设备");
        setTimeout(() => {
          refreshBluetoothDevices();
          api.getDesktopStatus().then(setStatus).catch(() => {});
        }, 1200);
      })
      .catch(() => setBluetoothMessage(device.connected ? "断开蓝牙设备失败" : "连接蓝牙设备失败"));
  };
  const refreshAudioOutputs = () => {
    api.listAudioOutputs()
      .then((items) => {
        setAudioOutputs(items);
        setAudioOutputMessage(items.length === 0 ? "未读取到音频输出设备" : null);
      })
      .catch(() => {
        setAudioOutputs([]);
        setAudioOutputMessage("读取音频输出失败");
      });
  };
  const refreshAudioInputs = () => {
    api.listAudioInputs()
      .then((items) => {
        setAudioInputs(items);
        setAudioInputMessage(items.length === 0 ? "未读取到麦克风输入设备" : null);
      })
      .catch(() => {
        setAudioInputs([]);
        setAudioInputMessage("读取麦克风输入失败");
      });
  };
  const setAudioOutput = (device: AudioOutputDevice) => {
    api.setAudioOutput(device.id)
      .then(() => {
        setAudioOutputMessage("音频输出已切换");
        refreshAudioOutputs();
        api.getDesktopStatus().then(setStatus).catch(() => {});
      })
      .catch(() => setAudioOutputMessage("切换音频输出失败"));
  };
  const setAudioInput = (device: AudioInputDevice) => {
    api.setAudioInput(device.id)
      .then(() => {
        setAudioInputMessage("麦克风输入已切换");
        refreshAudioInputs();
      })
      .catch(() => setAudioInputMessage("切换麦克风输入失败"));
  };
  const refreshInputMethods = () => {
    api.listInputMethods()
      .then((items) => {
        setInputMethods(items);
        setInputMethodMessage(items.length === 0 ? "未读取到输入法引擎" : null);
      })
      .catch(() => {
        setInputMethods([]);
        setInputMethodMessage("读取输入法失败");
      });
  };
  const setInputMethod = (engine: InputMethodEngine) => {
    api.setInputMethod(engine.id)
      .then(() => {
        setInputMethodMessage("输入法已切换");
        refreshInputMethods();
        api.getDesktopStatus().then(setStatus).catch(() => {});
      })
      .catch(() => setInputMethodMessage("切换输入法失败"));
  };
  const refreshClipboardHistory = () => {
    api.listClipboardHistory()
      .then((items) => {
        setClipboardItems(items);
        setClipboardMessage(items.length === 0 ? "未读取到剪贴板历史" : null);
      })
      .catch(() => {
        setClipboardItems([]);
        setClipboardMessage("读取剪贴板历史失败");
      });
  };
  const restoreClipboardHistory = (item: ClipboardHistoryItem) => {
    api.restoreClipboardHistory(item.id)
      .then(() => setClipboardMessage("已恢复到剪贴板"))
      .catch(() => setClipboardMessage("恢复剪贴板失败"));
  };
  const refreshWorkspaces = () => {
    api.listWorkspaces()
      .then((items) => {
        setWorkspaces(items);
        setWorkspaceMessage(null);
      })
      .catch(() => {
        setWorkspaces([]);
        setWorkspaceMessage("读取工作区失败");
      });
  };
  const switchWorkspace = (workspace: WorkspaceInfo) => {
    api.switchWorkspace(workspace.index)
      .then(refreshWorkspaces)
      .catch(() => setWorkspaceMessage("切换工作区失败"));
  };
  const moveFocusedWindowToWorkspace = (workspace: WorkspaceInfo) => {
    api.moveFocusedWindowToWorkspace(workspace.index)
      .then(() => setWorkspaceMessage(`已移动到 ${workspace.name}`))
      .catch(() => setWorkspaceMessage("移动窗口失败"));
  };
  const takeScreenshot = (mode: "full" | "select") => {
    setScreenshotMessage(mode === "select" ? "选择截图区域…" : "正在截图…");
    api.takeScreenshot(mode)
      .then(() => setScreenshotMessage("截图已保存到图片目录"))
      .catch(() => setScreenshotMessage("截图失败"));
  };
  const refreshPrinters = () => {
    api.listPrinters().then(setPrinters).catch(() => {
      setPrinters([]);
      setPrinterMessage("读取打印机失败");
    });
  };
  const setPrinterEnabled = (printer: PrinterStatus) => {
    api.setPrinterEnabled(printer.name, !printer.enabled)
      .then(() => {
        setPrinterMessage(printer.enabled ? "打印机已暂停" : "打印机已启用");
        refreshPrinters();
      })
      .catch(() => setPrinterMessage(printer.enabled ? "暂停打印机失败" : "启用打印机失败"));
  };
  const cancelPrinterJobs = (printer: PrinterStatus) => {
    api.cancelPrinterJobs(printer.name)
      .then(() => {
        setPrinterMessage("打印队列已清空");
        refreshPrinters();
      })
      .catch(() => setPrinterMessage("清空打印队列失败"));
  };
  const refreshVpnStatus = () => {
    api.getVpnStatus().then(setVpnStatus).catch(() => {
      setVpnStatus({ available: false, configuredCount: 0, connections: [], activeConnections: [] });
      setVpnMessage("读取 VPN 状态失败");
    });
  };
  const setVpnConnectionActive = (vpn: { name: string; active: boolean }) => {
    api.setVpnConnectionActive(vpn.name, !vpn.active)
      .then(() => {
        setVpnMessage(vpn.active ? "VPN 正在断开" : "VPN 正在连接");
        setTimeout(refreshVpnStatus, 1200);
      })
      .catch(() => setVpnMessage(vpn.active ? "断开 VPN 失败" : "连接 VPN 失败"));
  };
  const refreshPowerStatus = () => {
    api.getPowerStatus().then(setPowerStatus).catch(() => {
      setPowerStatus({ acOnline: true, batteries: [], powerProfiles: { available: false, active: null, profiles: [] } });
      setPowerMessage("读取电源状态失败");
    });
  };
  const setPowerProfile = (profile: PowerProfileId) => {
    api.setPowerProfile(profile)
      .then((status) => {
        setPowerStatus(status);
        setPowerMessage("电源模式已更新");
      })
      .catch(() => setPowerMessage("切换电源模式失败"));
  };
  const refreshStorageVolumes = () => {
    api.listStorageVolumes()
      .then((items) => {
        setStorageVolumes(items);
        setStorageMessage(items.length === 0 ? "未读取到存储卷" : null);
      })
      .catch(() => {
        setStorageVolumes([]);
        setStorageMessage("读取存储设备失败");
      });
  };
  const mountStorageVolume = (volume: StorageVolume) => {
    setStorageMessage(`正在挂载 ${volume.label}`);
    api.mountStorageVolume(volume.path)
      .then(() => {
        setStorageMessage("存储设备已挂载");
        refreshStorageVolumes();
      })
      .catch(() => setStorageMessage("挂载失败"));
  };
  const unmountStorageVolume = (volume: StorageVolume) => {
    setStorageMessage(`正在卸载 ${volume.label}`);
    api.unmountStorageVolume(volume.path)
      .then(() => {
        setStorageMessage("存储设备已卸载");
        refreshStorageVolumes();
      })
      .catch(() => setStorageMessage("卸载失败"));
  };
  const powerOffStorageVolume = (volume: StorageVolume) => {
    setStorageMessage(`正在安全移除 ${volume.label}`);
    api.powerOffStorageVolume(volume.path)
      .then(() => {
        setStorageMessage("存储设备可安全拔出");
        refreshStorageVolumes();
      })
      .catch(() => setStorageMessage("安全移除失败"));
  };
  const openStorageVolume = (volume: StorageVolume) => {
    const mountpoint = volume.mountpoints[0];
    if (!mountpoint) {
      setStorageMessage("该设备尚未挂载");
      return;
    }
    api.openStorageVolume(mountpoint).catch(() => setStorageMessage("打开存储设备失败"));
  };
  const refreshAccessibilityStatus = () => {
    api.getAccessibilityStatus().then(setAccessibilityStatus).catch(() => {
      setAccessibilityStatus({
        available: false,
        screenReader: false,
        highContrast: false,
        stickyKeys: false,
        slowKeys: false,
        reduceMotion: false,
      });
      setAccessibilityMessage("读取无障碍状态失败");
    });
  };
  const refreshNightLightStatus = () => {
    api.getNightLightStatus().then(setNightLightStatus).catch(() => {
      setNightLightStatus({ available: false, enabled: false, temperature: 4500 });
      setNightLightMessage("读取夜间模式失败");
    });
  };
  const refreshNotificationStatus = () => {
    api.getNotificationStatus().then(setNotificationStatus).catch(() => {
      setNotificationStatus({ available: false, daemon: "none", doNotDisturb: false });
      setNotificationMessage("读取通知状态失败");
    });
  };
  const setNotificationDoNotDisturb = (enabled: boolean) => {
    api.setNotificationDoNotDisturb(enabled)
      .then((status) => {
        setNotificationStatus(status);
        setNotificationMessage(enabled ? "免打扰已开启" : "免打扰已关闭");
      })
      .catch(() => setNotificationMessage("通知服务不可控制"));
  };
  const setNightLight = (enabled: boolean, temperature = nightLightStatus.temperature) => {
    api.setNightLight(enabled, temperature)
      .then((status) => {
        setNightLightStatus(status);
        setNightLightMessage(enabled ? "夜间模式已开启" : "夜间模式已关闭");
      })
      .catch(() => setNightLightMessage("更新夜间模式失败"));
  };
  const setAccessibilityFeature = (
    feature: AccessibilityFeature,
    field: keyof Omit<AccessibilityStatus, "available">,
  ) => {
    const next = !accessibilityStatus[field];
    api.setAccessibilityFeature(feature, next)
      .then(() => {
        setAccessibilityMessage(next ? "辅助功能已开启" : "辅助功能已关闭");
        refreshAccessibilityStatus();
      })
      .catch(() => setAccessibilityMessage("更新辅助功能失败"));
  };
  const toggleDisplayOutput = (output: DisplayOutput) => {
    api.setDisplayOutputEnabled(output.name, !output.enabled)
      .then(refreshDisplayOutputs)
      .catch(() => setDisplayMessage("不能关闭最后一个显示器"));
  };
  const setDisplayMode = (output: DisplayOutput, mode: string) => {
    if (!mode || mode === output.currentMode) return;
    api.setDisplayOutputMode(output.name, mode)
      .then(() => {
        setDisplayMessage("分辨率已更新");
        refreshDisplayOutputs();
      })
      .catch(() => setDisplayMessage("更新分辨率失败"));
  };
  const setDisplayScale = (output: DisplayOutput, scale: string) => {
    if (!scale || scale === output.scale) return;
    api.setDisplayOutputScale(output.name, scale)
      .then(() => {
        setDisplayMessage("缩放已更新");
        refreshDisplayOutputs();
      })
      .catch(() => setDisplayMessage("更新缩放失败"));
  };
  const setDisplayTransform = (output: DisplayOutput, transform: string) => {
    if (!transform || transform === output.transform) return;
    api.setDisplayOutputTransform(output.name, transform)
      .then(() => {
        setDisplayMessage("旋转已更新");
        refreshDisplayOutputs();
      })
      .catch(() => setDisplayMessage("更新旋转失败"));
  };
  const saveDisplayProfile = () => {
    api.saveDisplayProfile()
      .then(() => {
        setDisplayMessage("当前布局已保存");
        refreshDisplayOutputs();
      })
      .catch(() => setDisplayMessage("保存布局失败"));
  };
  const deleteDisplayProfile = (name: string) => {
    api.deleteDisplayProfile(name)
      .then(() => {
        setDisplayMessage("布局已删除");
        refreshDisplayOutputs();
      })
      .catch(() => setDisplayMessage("删除布局失败"));
  };
  const applyDisplayProfile = (name: string) => {
    api.applyDisplayProfile(name)
      .then(() => {
        setDisplayMessage("布局已应用");
        refreshDisplayOutputs();
      })
      .catch(() => setDisplayMessage("应用布局失败"));
  };
  const renameDisplayProfile = (name: string) => {
    const next = window.prompt("新的布局名称（英文字母/数字/连字符）", name.replace(/^salmon-/, ""));
    if (!next) return;
    api.renameDisplayProfile(name, next)
      .then(() => {
        setDisplayMessage("布局已重命名");
        refreshDisplayOutputs();
      })
      .catch(() => setDisplayMessage("重命名布局失败"));
  };
  const startDisplayDrag = (event: DragEvent<HTMLDivElement>, name: string) => {
    event.dataTransfer.setData("text/plain", name);
    event.dataTransfer.effectAllowed = "move";
  };
  const dropDisplayTile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const name = event.dataTransfer.getData("text/plain");
    const tile = displayLayout.tiles.find((item) => item.name === name);
    if (!tile) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const relY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const nextX = quantizeOutputPosition(displayLayout.minX + (relX / rect.width) * displayLayout.width - tile.width / 2);
    const nextY = quantizeOutputPosition(displayLayout.minY + (relY / rect.height) * displayLayout.height - tile.height / 2);
    api.setDisplayOutputPosition(name, nextX, nextY)
      .then(() => {
        setDisplayMessage("显示器位置已更新");
        refreshDisplayOutputs();
      })
      .catch(() => setDisplayMessage("调整显示器位置失败"));
  };

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".topbar")) setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [panel]);

  useEffect(() => {
    if (panel === "quick") {
      refreshWifiNetworks(false);
      refreshAudioOutputs();
      refreshAudioInputs();
      refreshInputMethods();
      refreshClipboardHistory();
      refreshWorkspaces();
      refreshBluetoothDevices();
      refreshDisplayOutputs();
      refreshPrinters();
      refreshVpnStatus();
      refreshPowerStatus();
      refreshStorageVolumes();
      refreshAccessibilityStatus();
      refreshNightLightStatus();
    }
    if (panel === "notifications") {
      refreshNotificationStatus();
    }
  }, [panel]);

  return (
    <div className="topbar">
      <div className="tb-activities" title="Activities" onClick={onActivities}>
        <span className="dot" />
        <span>Activities</span>
      </div>

      <button
        className={`tb-clock${panel === "calendar" ? " is-open" : ""}`}
        type="button"
        onClick={() => setPanel((p) => p === "calendar" ? null : "calendar")}
      >
        <span>{wd}</span>
        <span>{date}</span>
        <span className="sep">·</span>
        <span>{time}</span>
        {briefCount > 0 && <span className="tb-badge" title={`${briefCount} briefings ready`}>{briefCount}</span>}
      </button>

      <div className="tb-tray">
        <button
          className={`tb-btn${panel === "notifications" ? " is-open" : ""}`}
          title="Notifications"
          type="button"
          onClick={() => setPanel((p) => p === "notifications" ? null : "notifications")}
        >
          <Icons.Bell />
          {visibleNotifications.length > 0 && <span className="tb-dot" />}
        </button>
        <button
          className={`tb-btn${status.hasNetwork ? "" : " is-dim"}`}
          title={`Network: ${status.networkLabel}`}
          type="button"
          onClick={() => launchSystemApp("network-settings", "网络设置")}
        >
          <Icons.Wifi />
          <span>{status.networkLabel}</span>
        </button>
        <button
          className={`tb-btn${status.muted ? " is-dim" : ""}`}
          title={`Volume: ${status.volumeLabel}`}
          type="button"
          onClick={() => launchSystemApp("sound-settings", "声音设置")}
        >
          <Icons.Volume />
          <span>{status.volumeLabel}</span>
        </button>
        <button
          className={`tb-btn${status.hasBluetooth ? "" : " is-dim"}`}
          title={`Bluetooth: ${status.bluetoothLabel}`}
          type="button"
          onClick={() => launchSystemApp("bluetooth-settings", "蓝牙设置")}
        >
          <Icons.Bluetooth />
          <span>{status.bluetoothLabel}</span>
        </button>
        <button
          className="tb-btn"
          title={`Battery: ${status.batteryLabel}${status.charging ? " / charging" : ""}`}
          type="button"
          onClick={() => launchSystemApp("power-settings", "电源设置")}
        >
          <Icons.Battery />
          <span>{status.batteryLabel}</span>
        </button>
        <button
          className="tb-btn tb-input"
          title={`Input method: ${status.inputLabel}`}
          type="button"
          onClick={() => launchSystemApp("input-settings", "输入法设置")}
        >
          <span>{status.inputLabel}</span>
        </button>
        <button
          className="tb-btn"
          title="退出会话 (Super+Shift+Q)"
          type="button"
          onClick={() => setPanel((p) => p === "quick" ? null : "quick")}
        >
          <Icons.Close />
        </button>
      </div>

      {panel === "calendar" && (
        <div className="tb-popover tb-calendar" onClick={(e) => e.stopPropagation()}>
          <div className="tb-pop-title">{fullDate}</div>
          <div className="tb-pop-time">{time}</div>
          <div className="tb-month-head">
            <span>{calendarMonth}</span>
            <button type="button" onClick={() => launchSystemApp("datetime-settings", "日期与时间设置")}>
              日期与时间
            </button>
          </div>
          <div className="tb-month-grid" aria-label="月历">
            {WEEKDAYS.map((day) => (
              <span key={day} className="tb-month-weekday">{day.slice(1)}</span>
            ))}
            {calendarCells.map((cell) => (
              <span
                key={cell.key}
                className={`tb-month-day${cell.currentMonth ? "" : " is-muted"}${cell.today ? " is-today" : ""}`}
              >
                {cell.day}
              </span>
            ))}
          </div>
          <div className="tb-pop-row">
            <span>Salmon Brief</span>
            <strong>{briefCount > 0 ? `${briefCount} 项待处理` : "暂无待处理"}</strong>
          </div>
          <div className="tb-pop-row tb-agenda-row">
            <span>下一项日程</span>
            <strong>{nextEventLabel}</strong>
          </div>
          <div className="tb-pop-actions">
            <button type="button" onClick={() => { setPanel(null); onNavigateCalendar?.(); }}>
              打开日历
            </button>
            <button type="button" onClick={() => { setPanel(null); onActivities(); }}>
              Activities
            </button>
          </div>
        </div>
      )}

      {panel === "quick" && (
        <div className="tb-popover tb-quick" onClick={(e) => e.stopPropagation()}>
          <div className="tb-pop-grid">
            <button type="button" onClick={() => launchSystemApp("network-settings", "网络设置")}>
              <Icons.Wifi /><span>{status.networkLabel}</span>
            </button>
            <button type="button" onClick={() => launchSystemApp("sound-settings", "声音设置")}>
              <Icons.Volume /><span>{status.volumeLabel}</span>
            </button>
            <button type="button" onClick={() => launchSystemApp("power-settings", "电源设置")}>
              <Icons.Battery /><span>{status.batteryLabel}</span>
            </button>
            <button type="button" onClick={() => launchSystemApp("bluetooth-settings", "蓝牙设置")}>
              <Icons.Bluetooth /><span>{status.bluetoothLabel}</span>
            </button>
            <button type="button" onClick={() => runDesktopControl("brightness-up")}>
              <Icons.Sun /><span>{status.brightnessLabel}</span>
            </button>
            <button type="button" onClick={() => launchSystemApp("display-settings", "显示设置")}>
              <Icons.Monitor /><span>显示</span>
            </button>
            <button type="button" onClick={() => launchSystemApp("input-settings", "输入法设置")}>
              <span className="tb-input-mark">{status.inputLabel}</span><span>输入法</span>
            </button>
            <button type="button" onClick={refreshClipboardHistory}>
              <Icons.Clipboard /><span>剪贴板</span>
            </button>
            <button type="button" onClick={refreshWorkspaces}>
              <Icons.Monitor /><span>工作区</span>
            </button>
            <button type="button" onClick={() => takeScreenshot("full")}>
              <Icons.Camera /><span>截图</span>
            </button>
            <button type="button" onClick={refreshStorageVolumes}>
              <Icons.Folder /><span>存储</span>
            </button>
          </div>
          <div className="tb-pop-grid tb-system-grid">
            <button type="button" onClick={() => launchSystemApp("printer-settings", "打印机设置")}>
              <Icons.Printer /><span>打印机</span>
            </button>
            <button type="button" onClick={() => launchSystemApp("vpn-settings", "VPN 设置")}>
              <Icons.Shield /><span>VPN</span>
            </button>
            <button type="button" onClick={() => launchSystemApp("accessibility-settings", "无障碍设置")}>
              <Icons.Accessibility /><span>无障碍</span>
            </button>
            <button type="button" onClick={() => launchSystemApp("about-settings", "系统信息")}>
              <Icons.Info /><span>系统信息</span>
            </button>
          </div>
          {systemMessage && <div className="tb-display-empty">{systemMessage}</div>}
          <div className="tb-control-rows">
            <div className="tb-control-row">
              <span>Wi-Fi</span>
              <div>
                <button type="button" onClick={() => runDesktopControl("wifi-toggle")}>{status.hasNetwork ? "关闭" : "开启"}</button>
                <button type="button" onClick={() => launchSystemApp("network-settings", "网络设置")}>设置</button>
              </div>
            </div>
            <div className="tb-control-row">
              <span>蓝牙</span>
              <div>
                <button type="button" onClick={() => runDesktopControl("bluetooth-toggle")}>{status.bluetoothLabel === "BT Off" ? "开启" : "关闭"}</button>
                <button type="button" onClick={() => launchSystemApp("bluetooth-settings", "蓝牙设置")}>设置</button>
              </div>
            </div>
            <div className="tb-control-row">
              <span>音量</span>
              <div>
                <button type="button" onClick={() => runDesktopControl("volume-down")}>-</button>
                <button type="button" onClick={() => runDesktopControl("volume-mute")}>静音</button>
                <button type="button" onClick={() => runDesktopControl("volume-up")}>+</button>
              </div>
            </div>
            <div className="tb-control-row">
              <span>麦克风</span>
              <div>
                <button type="button" onClick={() => runDesktopControl("mic-mute")}>静音</button>
                <button type="button" onClick={() => launchSystemApp("sound-settings", "声音设置")}>设置</button>
              </div>
            </div>
            <div className="tb-control-row">
              <span>亮度</span>
              <div>
                <button type="button" onClick={() => runDesktopControl("brightness-down")}>-</button>
                <button type="button" onClick={() => runDesktopControl("brightness-up")}>+</button>
              </div>
            </div>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>夜间模式</span>
              <button type="button" onClick={refreshNightLightStatus}>刷新</button>
            </div>
            {!nightLightStatus.available ? (
              <div className="tb-display-empty">未检测到 gammastep；安装后可调节屏幕色温。</div>
            ) : (
              <div className={`tb-display-row tb-night-light-row${nightLightStatus.enabled ? " is-active" : ""}`}>
                <div>
                  <strong>{nightLightStatus.enabled ? "暖色显示已开启" : "标准色温"}</strong>
                  <span>{nightLightStatus.temperature}K</span>
                  <em>降低夜间蓝光，适合低光环境</em>
                </div>
                <div className="tb-night-light-controls">
                  <input
                    min={2500}
                    max={6500}
                    step={100}
                    type="range"
                    value={nightLightStatus.temperature}
                    onChange={(event) => {
                      const temperature = Number(event.currentTarget.value);
                      setNightLightStatus((cur) => ({ ...cur, temperature }));
                    }}
                    onPointerUp={() => {
                      if (nightLightStatus.enabled) setNightLight(true, nightLightStatus.temperature);
                    }}
                  />
                  <button type="button" onClick={() => setNightLight(!nightLightStatus.enabled)}>
                    {nightLightStatus.enabled ? "关闭" : "开启"}
                  </button>
                </div>
              </div>
            )}
            {nightLightMessage && <div className="tb-display-empty">{nightLightMessage}</div>}
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>电源</span>
              <button type="button" onClick={refreshPowerStatus}>刷新</button>
            </div>
            {powerStatus.batteries.length === 0 ? (
              <div className="tb-display-empty">{powerStatus.acOnline ? "正在使用外接电源；未检测到电池。" : "未检测到电池或外接电源状态。"}</div>
            ) : powerStatus.batteries.map((battery) => {
              const remaining = formatBatteryTime(battery.timeRemainingMinutes);
              return (
                <div key={battery.name} className={`tb-display-row tb-power-status-row${powerStatus.acOnline ? " is-charging" : ""}`}>
                  <div>
                    <strong>{battery.name} · {battery.percentage != null ? `${battery.percentage}%` : "未知电量"}</strong>
                    <span>{battery.status}{powerStatus.acOnline ? " · 已接通电源" : " · 使用电池"}</span>
                    <em>
                      {remaining
                        ? `${battery.status === "Charging" ? "预计充满" : "预计剩余"} ${remaining}`
                        : battery.powerNow != null ? `${battery.powerNow.toFixed(1)} W` : "时间估算不可用"}
                    </em>
                  </div>
                  <button type="button" onClick={() => launchSystemApp("power-settings", "电源设置")}>
                    设置
                  </button>
                </div>
              );
            })}
            {powerStatus.powerProfiles.available && powerStatus.powerProfiles.profiles.length > 0 ? (
              <div className="tb-power-profile-row">
                {POWER_PROFILES
                  .filter((profile) => powerStatus.powerProfiles.profiles.some((item) => item.id === profile.id))
                  .map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={powerStatus.powerProfiles.active === profile.id ? "is-active" : ""}
                      onClick={() => setPowerProfile(profile.id)}
                    >
                      {profile.label}
                    </button>
                  ))}
              </div>
            ) : (
              <div className="tb-display-empty">该硬件未提供电源模式切换。</div>
            )}
            {powerMessage && <div className="tb-display-empty">{powerMessage}</div>}
            <div className="tb-pop-actions">
              <button type="button" onClick={() => runSessionAction("lock")}>锁屏</button>
              <button type="button" onClick={() => runSessionAction("suspend")}>挂起</button>
            </div>
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("power-settings", "电源设置")}
            >
              电源设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>存储设备</span>
              <button type="button" onClick={refreshStorageVolumes}>刷新</button>
            </div>
            {storageVolumes.length === 0 ? (
              <div className="tb-display-empty">{storageMessage ?? "未检测到可显示的存储卷。"}</div>
            ) : storageVolumes.slice(0, 8).map((volume) => (
              <div key={volume.path} className={`tb-display-row tb-storage-row${volume.mounted ? " is-mounted" : ""}`}>
                <div>
                  <strong>{volume.label}</strong>
                  <span>{volume.mounted ? volume.mountpoints.join("、") : "未挂载"}</span>
                  <em>
                    {[volume.size, volume.fsType || "未知文件系统", volume.removable ? "可移动" : "本地磁盘"]
                      .filter(Boolean)
                      .join(" · ")}
                  </em>
                </div>
                <div className="tb-display-row-actions">
                  {volume.mounted ? (
                    <>
                      <button type="button" onClick={() => openStorageVolume(volume)}>打开</button>
                      {canUnmountStorageVolume(volume) && (
                        <button type="button" onClick={() => unmountStorageVolume(volume)}>卸载</button>
                      )}
                      {volume.removable && (
                        <button type="button" onClick={() => powerOffStorageVolume(volume)}>移除</button>
                      )}
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => mountStorageVolume(volume)}>挂载</button>
                      {volume.removable && (
                        <button type="button" onClick={() => powerOffStorageVolume(volume)}>移除</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            {storageMessage && storageVolumes.length > 0 && <div className="tb-display-empty">{storageMessage}</div>}
            <div className="tb-note-muted">可移动介质由 udiskie 自动处理；这里提供手动挂载、打开、卸载和安全移除入口。</div>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>Wi-Fi 网络</span>
              <button type="button" onClick={() => refreshWifiNetworks(true)}>扫描</button>
            </div>
            {wifiNetworks.length === 0 ? (
              <div className="tb-display-empty">{wifiMessage ?? "未读取到 Wi-Fi 网络"}</div>
            ) : wifiNetworks.slice(0, 6).map((network) => (
              <div key={network.ssid} className={`tb-display-row tb-wifi-row${network.active ? " is-active" : ""}`}>
                <div>
                  <strong>{network.ssid}</strong>
                  <span>{network.active ? "已连接" : network.security ? network.security : "开放网络"}</span>
                  <em>信号 {network.signal}%</em>
                </div>
                <button
                  type="button"
                  onClick={() => network.active ? launchSystemApp("network-settings", "网络设置") : connectWifiNetwork(network)}
                >
                  {network.active ? "设置" : "连接"}
                </button>
              </div>
            ))}
            {wifiMessage && wifiNetworks.length > 0 && <div className="tb-display-empty">{wifiMessage}</div>}
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("network-settings", "网络设置")}
            >
              网络设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>音频输出</span>
              <button type="button" onClick={refreshAudioOutputs}>刷新</button>
            </div>
            {audioOutputs.length === 0 ? (
              <div className="tb-display-empty">{audioOutputMessage ?? "未读取到音频输出设备"}</div>
            ) : audioOutputs.slice(0, 6).map((device) => (
              <div key={device.id} className={`tb-display-row tb-audio-row${device.active ? " is-active" : ""}`}>
                <div>
                  <strong>{device.name}</strong>
                  <span>{device.active ? "默认输出" : "可用输出"}</span>
                  <em>{device.volume}</em>
                </div>
                <button
                  type="button"
                  onClick={() => device.active ? launchSystemApp("sound-settings", "声音设置") : setAudioOutput(device)}
                >
                  {device.active ? "设置" : "切换"}
                </button>
              </div>
            ))}
            {audioOutputMessage && audioOutputs.length > 0 && <div className="tb-display-empty">{audioOutputMessage}</div>}
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("sound-settings", "声音设置")}
            >
              声音设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>麦克风输入</span>
              <button type="button" onClick={refreshAudioInputs}>刷新</button>
            </div>
            {audioInputs.length === 0 ? (
              <div className="tb-display-empty">{audioInputMessage ?? "未读取到麦克风输入设备"}</div>
            ) : audioInputs.slice(0, 6).map((device) => (
              <div key={device.id} className={`tb-display-row tb-audio-row${device.active ? " is-active" : ""}`}>
                <div>
                  <strong>{device.name}</strong>
                  <span>{device.active ? "默认输入" : "可用输入"}</span>
                  <em>{device.volume}</em>
                </div>
                <button
                  type="button"
                  onClick={() => device.active ? launchSystemApp("sound-settings", "声音设置") : setAudioInput(device)}
                >
                  {device.active ? "设置" : "切换"}
                </button>
              </div>
            ))}
            {audioInputMessage && audioInputs.length > 0 && <div className="tb-display-empty">{audioInputMessage}</div>}
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("sound-settings", "声音设置")}
            >
              声音设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>输入法</span>
              <button type="button" onClick={refreshInputMethods}>刷新</button>
            </div>
            {inputMethods.length === 0 ? (
              <div className="tb-display-empty">{inputMethodMessage ?? "未读取到输入法引擎；可打开输入法设置。"}</div>
            ) : inputMethods.slice(0, 8).map((engine) => (
              <div key={`${engine.framework}:${engine.id}`} className={`tb-display-row tb-input-row${engine.active ? " is-active" : ""}`}>
                <div>
                  <strong>{engine.name}</strong>
                  <span>{engine.active ? "当前输入法" : engine.framework}</span>
                  <em>{engine.id}</em>
                </div>
                <button
                  type="button"
                  onClick={() => engine.active ? runDesktopControl("input-toggle") : setInputMethod(engine)}
                >
                  {engine.active ? "切换" : "使用"}
                </button>
              </div>
            ))}
            {inputMethodMessage && inputMethods.length > 0 && <div className="tb-display-empty">{inputMethodMessage}</div>}
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("input-settings", "输入法设置")}
            >
              输入法设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>剪贴板历史</span>
              <button type="button" onClick={refreshClipboardHistory}>刷新</button>
            </div>
            {clipboardItems.length === 0 ? (
              <div className="tb-display-empty">
                {clipboardMessage ?? "未读取到 cliphist 历史；复制内容后会出现在这里。"}
              </div>
            ) : clipboardItems.slice(0, 8).map((item) => (
              <div key={item.id} className="tb-display-row tb-clipboard-row">
                <div>
                  <strong>{item.kind === "image" ? "图片内容" : "文本内容"}</strong>
                  <span>{item.preview}</span>
                  <em>{item.kind === "image" ? "cliphist binary item" : "cliphist text item"}</em>
                </div>
                <button type="button" onClick={() => restoreClipboardHistory(item)}>
                  恢复
                </button>
              </div>
            ))}
            {clipboardMessage && clipboardItems.length > 0 && <div className="tb-display-empty">{clipboardMessage}</div>}
            <div className="tb-note-muted">选择历史项会把内容重新放入 Wayland 剪贴板，之后可在任意应用粘贴。</div>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>工作区</span>
              <button type="button" onClick={refreshWorkspaces}>刷新</button>
            </div>
            {workspaces.length === 0 ? (
              <div className="tb-display-empty">{workspaceMessage ?? "未读取到工作区状态"}</div>
            ) : workspaces.map((workspace) => (
              <div key={workspace.index} className={`tb-display-row tb-workspace-row${workspace.active ? " is-active" : ""}`}>
                <div>
                  <strong>{workspace.index}. {workspace.name}</strong>
                  <span>{workspace.active ? "当前工作区" : "可切换工作区"}</span>
                  <em>Super+{workspace.index} / Super+Shift+{workspace.index}</em>
                </div>
                <div className="tb-display-row-actions">
                  <button type="button" onClick={() => switchWorkspace(workspace)}>
                    切换
                  </button>
                  <button type="button" onClick={() => moveFocusedWindowToWorkspace(workspace)}>
                    移动窗口
                  </button>
                </div>
              </div>
            ))}
            {workspaceMessage && <div className="tb-display-empty">{workspaceMessage}</div>}
            <div className="tb-note-muted">工作区状态由 Salmon 记录点击切换结果；键盘直接切换后可点刷新同步显示。</div>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>截图</span>
            </div>
            <div className="tb-pop-grid tb-screenshot-grid">
              <button type="button" onClick={() => takeScreenshot("full")}>
                <Icons.Camera /><span>全屏截图</span>
              </button>
              <button type="button" onClick={() => takeScreenshot("select")}>
                <Icons.Crop /><span>区域截图</span>
              </button>
            </div>
            {screenshotMessage && <div className="tb-display-empty">{screenshotMessage}</div>}
            <div className="tb-note-muted">截图保存到 Pictures/Screenshots；键盘快捷键仍是 Print 和 Shift+Print。</div>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>蓝牙设备</span>
              <button type="button" onClick={refreshBluetoothDevices}>刷新</button>
            </div>
            {!status.hasBluetooth ? (
              <div className="tb-display-empty">未检测到蓝牙控制器。</div>
            ) : bluetoothDevices.length === 0 ? (
              <div className="tb-display-empty">{bluetoothMessage ?? "未发现已知蓝牙设备"}</div>
            ) : bluetoothDevices.slice(0, 6).map((device) => (
              <div key={device.address} className={`tb-display-row tb-bluetooth-row${device.connected ? " is-active" : ""}`}>
                <div>
                  <strong>{device.name}</strong>
                  <span>{device.connected ? "已连接" : device.paired ? "已配对" : "未配对"}</span>
                  <em>{device.trusted ? "已信任" : device.address}</em>
                </div>
                <button type="button" onClick={() => setBluetoothDeviceConnected(device)}>
                  {device.connected ? "断开" : "连接"}
                </button>
              </div>
            ))}
            {bluetoothMessage && bluetoothDevices.length > 0 && <div className="tb-display-empty">{bluetoothMessage}</div>}
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("bluetooth-settings", "蓝牙设置")}
            >
              蓝牙设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>VPN</span>
              <button type="button" onClick={refreshVpnStatus}>刷新</button>
            </div>
            {!vpnStatus.available ? (
              <div className="tb-display-empty">未检测到 NetworkManager；可打开系统网络设置。</div>
            ) : vpnStatus.connections.length === 0 ? (
              <div className="tb-display-empty">
                {vpnStatus.configuredCount > 0 ? `${vpnStatus.configuredCount} 个 VPN 已配置，当前未读取到连接详情。` : "未配置 VPN。"}
              </div>
            ) : vpnStatus.connections.map((vpn) => (
              <div key={vpn.name} className={`tb-display-row tb-vpn-row${vpn.active ? " is-active" : ""}`}>
                <div>
                  <strong>{vpn.name}</strong>
                  <span>{vpn.active ? "VPN 已连接" : "VPN 未连接"}</span>
                  <em>{vpn.device ? `接口 ${vpn.device}` : "NetworkManager VPN 配置"}</em>
                </div>
                <button type="button" onClick={() => setVpnConnectionActive(vpn)}>
                  {vpn.active ? "断开" : "连接"}
                </button>
              </div>
            ))}
            {vpnMessage && <div className="tb-display-empty">{vpnMessage}</div>}
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("vpn-settings", "VPN 设置")}
            >
              VPN 设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>无障碍</span>
              <button type="button" onClick={refreshAccessibilityStatus}>刷新</button>
            </div>
            {!accessibilityStatus.available ? (
              <div className="tb-display-empty">未检测到 gsettings；可打开系统无障碍设置。</div>
            ) : (
              ACCESSIBILITY_FEATURES.map((feature) => {
                const enabled = Boolean(accessibilityStatus[feature.field]);
                return (
                  <div key={feature.id} className={`tb-display-row tb-accessibility-row${enabled ? " is-active" : ""}`}>
                    <div>
                      <strong>{feature.label}</strong>
                      <span>{enabled ? "已启用" : "未启用"}</span>
                      <em>{feature.description}</em>
                    </div>
                    <button type="button" onClick={() => setAccessibilityFeature(feature.id, feature.field)}>
                      {enabled ? "关闭" : "开启"}
                    </button>
                  </div>
                );
              })
            )}
            {accessibilityMessage && <div className="tb-display-empty">{accessibilityMessage}</div>}
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("accessibility-settings", "无障碍设置")}
            >
              无障碍设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>打印机</span>
              <button type="button" onClick={refreshPrinters}>刷新</button>
            </div>
            {printers.length === 0 ? (
              <div className="tb-display-empty">未配置打印机；可打开系统打印机设置。</div>
            ) : printers.map((printer) => (
              <div key={printer.name} className={`tb-display-row tb-printer-row${printer.enabled ? "" : " is-off"}`}>
                <div>
                  <strong>{printer.name}</strong>
                  <span>{printer.isDefault ? "默认打印机" : "打印机"}</span>
                  <em>
                    {printer.state}
                    {printer.queuedJobs > 0 ? ` · ${printer.queuedJobs} 个任务` : " · 队列为空"}
                  </em>
                </div>
                <div className="tb-display-row-actions">
                  <button type="button" onClick={() => setPrinterEnabled(printer)}>
                    {printer.enabled ? "暂停" : "启用"}
                  </button>
                  {printer.queuedJobs > 0 && (
                    <button type="button" onClick={() => cancelPrinterJobs(printer)}>
                      清空队列
                    </button>
                  )}
                </div>
              </div>
            ))}
            {printerMessage && <div className="tb-display-empty">{printerMessage}</div>}
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("printer-settings", "打印机设置")}
            >
              打印机设置
            </button>
          </div>
          <div className="tb-display-panel">
            <div className="tb-display-head">
              <span>显示器</span>
              <button type="button" onClick={refreshDisplayOutputs}>刷新</button>
            </div>
            {displayOutputs.length === 0 ? (
              <div className="tb-display-empty">未读取到 wlroots 输出；可打开高级显示设置。</div>
            ) : (
              <>
                {displayLayout.tiles.length > 0 && (
                  <div
                    className="tb-layout-map"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={dropDisplayTile}
                  >
                    {displayLayout.tiles.map((tile) => (
                      <div
                        key={tile.name}
                        className="tb-layout-tile"
                        draggable
                        onDragStart={(event) => startDisplayDrag(event, tile.name)}
                        style={{
                          left: `${tile.leftPct}%`,
                          top: `${tile.topPct}%`,
                          width: `${tile.widthPct}%`,
                          height: `${tile.heightPct}%`,
                        }}
                        title={`${tile.name}: ${tile.currentMode} @ ${tile.position}`}
                      >
                        <strong>{tile.name}</strong>
                        <span>{tile.position}</span>
                      </div>
                    ))}
                  </div>
                )}
                {displayOutputs.map((output) => (
                  <div key={output.name} className={`tb-display-row tb-display-output-row${output.enabled ? "" : " is-off"}`}>
                    <div className="tb-display-output-main">
                      <strong>{output.name}</strong>
                      <span>{output.description}</span>
                      <em>{output.enabled ? `${output.currentMode} · ${output.scale}x · ${output.position}` : "已关闭"}</em>
                      {output.enabled && (
                        <div className="tb-display-controls">
                          <label>
                            <span>模式</span>
                            <select
                              value={output.currentMode}
                              onChange={(event) => setDisplayMode(output, event.currentTarget.value)}
                            >
                              {output.modes.length === 0 && <option value={output.currentMode}>{output.currentMode || "默认"}</option>}
                              {output.modes.map((mode) => (
                                <option key={mode} value={mode}>{mode}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>缩放</span>
                            <select
                              value={output.scale}
                              onChange={(event) => setDisplayScale(output, event.currentTarget.value)}
                            >
                              {Array.from(new Set([output.scale, ...DISPLAY_SCALE_OPTIONS])).filter(Boolean).map((scale) => (
                                <option key={scale} value={scale}>{scale}x</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>旋转</span>
                            <select
                              value={output.transform}
                              onChange={(event) => setDisplayTransform(output, event.currentTarget.value)}
                            >
                              {DISPLAY_TRANSFORM_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => toggleDisplayOutput(output)}>
                      {output.enabled ? "关闭" : "开启"}
                    </button>
                  </div>
                ))}
              </>
            )}
            {displayMessage && <div className="tb-display-empty">{displayMessage}</div>}
            {displayProfiles.length > 0 && (
              <div className="tb-display-profiles">
                <div className="tb-display-head"><span>已保存布局</span></div>
                {displayProfiles.slice(0, 4).map((profile) => (
                  <div key={profile.name} className="tb-display-row tb-display-profile">
                    <div>
                      <strong>{profile.name}</strong>
                      <em>{profile.enabledCount}/{profile.outputCount} 个显示器启用</em>
                    </div>
                    <div className="tb-display-row-actions">
                      <button type="button" onClick={() => applyDisplayProfile(profile.name)}>应用</button>
                      <button type="button" onClick={() => renameDisplayProfile(profile.name)}>重命名</button>
                      <button type="button" onClick={() => deleteDisplayProfile(profile.name)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button className="tb-display-advanced" type="button" onClick={saveDisplayProfile}>
              保存当前布局
            </button>
            <button
              className="tb-display-advanced"
              type="button"
              onClick={() => launchSystemApp("display-settings", "显示设置")}
            >
              高级显示设置
            </button>
          </div>
          <div className="tb-pop-actions">
            <button type="button" onClick={() => { setPanel(null); onCycleWallpaper(); }}>换壁纸</button>
            <button type="button" onClick={() => { setPanel(null); onOpenSettings(); }}>Salmon 设置</button>
          </div>
          <div className="tb-power-row">
            <button type="button" onClick={() => runSessionAction("lock")}>锁屏</button>
            <button type="button" onClick={() => runSessionAction("suspend")}>挂起</button>
            <button type="button" onClick={() => runSessionAction("reboot")}>重启</button>
            <button type="button" onClick={() => runSessionAction("poweroff")}>关机</button>
            <button type="button" onClick={() => runSessionAction("signout")}>退出</button>
          </div>
        </div>
      )}

      {panel === "notifications" && (
        <div className="tb-popover tb-notifications" onClick={(e) => e.stopPropagation()}>
          <div className="tb-notification-head">
            <div>
              <div className="tb-pop-title">通知中心</div>
              <div className="tb-notification-sub">
                {visibleNotifications.length > 0 ? `${visibleNotifications.length} 条 Salmon 工作提醒` : "暂无新的 Salmon 工作提醒"}
              </div>
            </div>
            {notificationRows.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const next = notificationsDismissed ? "" : notificationSignature;
                  setDismissedSignature(next);
                  try {
                    if (next) localStorage.setItem(NOTIFICATION_DISMISS_KEY, next);
                    else localStorage.removeItem(NOTIFICATION_DISMISS_KEY);
                  } catch {}
                }}
              >
                {notificationsDismissed ? "恢复" : "清空"}
              </button>
            )}
          </div>
          <div className={`tb-dnd-row${notificationStatus.doNotDisturb ? " is-active" : ""}`}>
            <div>
              <strong>免打扰</strong>
              <span>
                {notificationStatus.available
                  ? `${notificationStatus.daemon} 通知服务`
                  : "未检测到可控制的通知服务"}
              </span>
              {notificationMessage && <em>{notificationMessage}</em>}
            </div>
            <button
              type="button"
              disabled={!notificationStatus.available}
              onClick={() => setNotificationDoNotDisturb(!notificationStatus.doNotDisturb)}
            >
              {notificationStatus.doNotDisturb ? "开启中" : "关闭"}
            </button>
          </div>
          {visibleNotifications.length === 0 ? (
            <div className="tb-note-card tb-note-empty">
              <div>
                <strong>{notificationsDismissed ? "当前提醒已清空" : "今天很安静"}</strong>
                <span>{notificationsDismissed ? "新的邮件、会议、任务或 AI 建议出现后会重新提示。" : "系统通知仍由通知服务显示。"}</span>
              </div>
            </div>
          ) : (
            <div className="tb-notification-list">
              {visibleNotifications.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`tb-notification-row kind-${row.kind}`}
                  onClick={() => {
                    setPanel(null);
                    row.onClick();
                  }}
                >
                  <span className="tb-notification-icon">
                    {row.kind === "mail" && <Icons.Mail />}
                    {row.kind === "calendar" && <Icons.Calendar />}
                    {row.kind === "task" && <Icons.CheckSquare />}
                    {row.kind === "ai" && <Icons.AIStar />}
                  </span>
                  <span className="tb-notification-text">
                    <strong>{row.title}</strong>
                    <em>{row.meta}</em>
                  </span>
                  <span className="tb-notification-action">{row.action}</span>
                </button>
              ))}
            </div>
          )}
          <div className="tb-note-muted">这里聚合 Salmon 桌面内的邮件、日程、任务和 AI 建议；系统级应用通知继续交给已安装的通知服务。</div>
        </div>
      )}
    </div>
  );
}
