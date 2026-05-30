import { invoke } from "@tauri-apps/api/core";
import type { BriefingFeed, BriefingRunResult, BriefingStatus, BriefItem, CalEvent, CliInfo, ComposeInput, ComposerSendMode, ContactBundle, ContactRow, CreateTaskInput, ExecuteStepInput, FileEntry, MailAccount, MailListItem, MailMessageFull, Message, OauthStatus, Recommendation, SearchResult, StepResult, Task, Topic, UnifiedContact, UpdateTaskInput, UsageSummary, WorkdirCheck } from "./types";

export type SystemAppKind =
  | "files"
  | "browser"
  | "settings"
  | "network-settings"
  | "sound-settings"
  | "power-settings"
  | "datetime-settings"
  | "input-settings"
  | "display-settings"
  | "bluetooth-settings"
  | "printer-settings"
  | "vpn-settings"
  | "accessibility-settings"
  | "about-settings";

export const api = {
  detectClis: () => invoke<{ clis: CliInfo[] }>("detect_clis"),
  signOutSession: () => invoke<void>("sign_out_session"),
  sessionAction: (action: "lock" | "suspend" | "reboot" | "poweroff" | "signout") =>
    invoke<void>("session_action", { action }),
  desktopControl: (action: "volume-up" | "volume-down" | "volume-mute" | "mic-mute" | "brightness-up" | "brightness-down" | "input-toggle" | "wifi-toggle" | "bluetooth-toggle") =>
    invoke<void>("desktop_control", { action }),
  quitApp: () => invoke<void>("quit_app"),
  openLink: (workdir: string, href: string) =>
    invoke<void>("open_link", { workdir, href }),
  launchTerminal: () => invoke<void>("launch_terminal"),
  getDesktopStatus: () =>
    invoke<{
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
    }>("get_desktop_status"),
  listWifiNetworks: (rescan = false) =>
    invoke<{ ssid: string; signal: number; security: string; active: boolean }[]>(
      "list_wifi_networks",
      { rescan },
    ),
  connectWifiNetwork: (ssid: string, password?: string | null) =>
    invoke<void>("connect_wifi_network", { ssid, password: password ?? null }),
  listAudioOutputs: () =>
    invoke<{ id: string; name: string; active: boolean; volume: string }[]>("list_audio_outputs"),
  setAudioOutput: (id: string) => invoke<void>("set_audio_output", { id }),
  listAudioInputs: () =>
    invoke<{ id: string; name: string; active: boolean; volume: string }[]>("list_audio_inputs"),
  setAudioInput: (id: string) => invoke<void>("set_audio_input", { id }),
  listInputMethods: () =>
    invoke<{ id: string; name: string; framework: string; active: boolean }[]>("list_input_methods"),
  setInputMethod: (id: string) => invoke<void>("set_input_method", { id }),
  listClipboardHistory: () =>
    invoke<{ id: string; preview: string; kind: string }[]>("list_clipboard_history"),
  restoreClipboardHistory: (id: string) => invoke<void>("restore_clipboard_history", { id }),
  listWorkspaces: () =>
    invoke<{ index: number; name: string; active: boolean }[]>("list_workspaces"),
  switchWorkspace: (index: number) => invoke<void>("switch_workspace", { index }),
  moveFocusedWindowToWorkspace: (index: number) =>
    invoke<void>("move_focused_window_to_workspace", { index }),
  takeScreenshot: (mode: "full" | "select") => invoke<void>("take_screenshot", { mode }),
  listBluetoothDevices: () =>
    invoke<{
      address: string;
      name: string;
      connected: boolean;
      paired: boolean;
      trusted: boolean;
    }[]>("list_bluetooth_devices"),
  setBluetoothDeviceConnected: (address: string, connected: boolean) =>
    invoke<void>("set_bluetooth_device_connected", { address, connected }),
  getSystemAppStatus: () =>
    invoke<{
      filesRunning: boolean;
      browserRunning: boolean;
      terminalRunning: boolean;
      settingsRunning: boolean;
    }>("get_system_app_status"),
  listDisplayOutputs: () =>
    invoke<{
      name: string;
      description: string;
      enabled: boolean;
      currentMode: string;
      scale: string;
      transform: string;
      position: string;
      modes: string[];
    }[]>("list_display_outputs"),
  listPrinters: () =>
    invoke<{
      name: string;
      state: string;
      enabled: boolean;
      isDefault: boolean;
      queuedJobs: number;
    }[]>("list_printers"),
  setPrinterEnabled: (name: string, enabled: boolean) =>
    invoke<void>("set_printer_enabled", { name, enabled }),
  cancelPrinterJobs: (name: string) => invoke<void>("cancel_printer_jobs", { name }),
  getVpnStatus: () =>
    invoke<{
      available: boolean;
      configuredCount: number;
      connections: { name: string; active: boolean; device: string | null }[];
      activeConnections: { name: string; active: boolean; device: string | null }[];
    }>("get_vpn_status"),
  setVpnConnectionActive: (name: string, active: boolean) =>
    invoke<void>("set_vpn_connection_active", { name, active }),
  getAccessibilityStatus: () =>
    invoke<{
      available: boolean;
      screenReader: boolean;
      highContrast: boolean;
      stickyKeys: boolean;
      slowKeys: boolean;
      reduceMotion: boolean;
    }>("get_accessibility_status"),
  setAccessibilityFeature: (
    feature: "screen-reader" | "high-contrast" | "sticky-keys" | "slow-keys" | "reduce-motion",
    enabled: boolean,
  ) => invoke<void>("set_accessibility_feature", { feature, enabled }),
  getNightLightStatus: () =>
    invoke<{ available: boolean; enabled: boolean; temperature: number }>("get_night_light_status"),
  setNightLight: (enabled: boolean, temperature?: number | null) =>
    invoke<{ available: boolean; enabled: boolean; temperature: number }>("set_night_light", {
      enabled,
      temperature: temperature ?? null,
    }),
  restoreNightLight: () =>
    invoke<{ available: boolean; enabled: boolean; temperature: number }>("restore_night_light"),
  getNotificationStatus: () =>
    invoke<{ available: boolean; daemon: string; doNotDisturb: boolean }>("get_notification_status"),
  setNotificationDoNotDisturb: (enabled: boolean) =>
    invoke<{ available: boolean; daemon: string; doNotDisturb: boolean }>(
      "set_notification_do_not_disturb",
      { enabled },
    ),
  getPowerStatus: () =>
    invoke<{
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
        active: "power-saver" | "balanced" | "performance" | null;
        profiles: { id: "power-saver" | "balanced" | "performance"; active: boolean }[];
      };
    }>("get_power_status"),
  setPowerProfile: (profile: "power-saver" | "balanced" | "performance") =>
    invoke<{
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
        active: "power-saver" | "balanced" | "performance" | null;
        profiles: { id: "power-saver" | "balanced" | "performance"; active: boolean }[];
      };
    }>("set_power_profile", { profile }),
  listStorageVolumes: () =>
    invoke<{
      name: string;
      path: string;
      label: string;
      size: string;
      fsType: string;
      removable: boolean;
      mounted: boolean;
      mountpoints: string[];
    }[]>("list_storage_volumes"),
  mountStorageVolume: (path: string) => invoke<void>("mount_storage_volume", { path }),
  unmountStorageVolume: (path: string) => invoke<void>("unmount_storage_volume", { path }),
  powerOffStorageVolume: (path: string) => invoke<void>("power_off_storage_volume", { path }),
  openStorageVolume: (mountpoint: string) => invoke<void>("open_storage_volume", { mountpoint }),
  setDisplayOutputEnabled: (name: string, enabled: boolean) =>
    invoke<void>("set_display_output_enabled", { name, enabled }),
  setDisplayOutputPosition: (name: string, x: number, y: number) =>
    invoke<void>("set_display_output_position", { name, x, y }),
  setDisplayOutputMode: (name: string, mode: string) =>
    invoke<void>("set_display_output_mode", { name, mode }),
  setDisplayOutputScale: (name: string, scale: string) =>
    invoke<void>("set_display_output_scale", { name, scale }),
  setDisplayOutputTransform: (name: string, transform: string) =>
    invoke<void>("set_display_output_transform", { name, transform }),
  saveDisplayProfile: () => invoke<string>("save_display_profile"),
  listDisplayProfiles: () =>
    invoke<{ name: string; outputCount: number; enabledCount: number }[]>("list_display_profiles"),
  deleteDisplayProfile: (name: string) => invoke<void>("delete_display_profile", { name }),
  applyDisplayProfile: (name: string) => invoke<void>("apply_display_profile", { name }),
  renameDisplayProfile: (name: string, newName: string) =>
    invoke<string>("rename_display_profile", { name, newName }),
  listExternalWindows: () =>
    invoke<{ id: string; appId: string; title: string; ambiguous: boolean }[]>("list_external_windows"),
  focusExternalWindow: (id: string, appId: string, title: string) =>
    invoke<void>("focus_external_window", { id, appId, title }),
  minimizeExternalWindow: (id: string, appId: string, title: string) =>
    invoke<void>("minimize_external_window", { id, appId, title }),
  maximizeExternalWindow: (id: string, appId: string, title: string) =>
    invoke<void>("maximize_external_window", { id, appId, title }),
  fullscreenExternalWindow: (id: string, appId: string, title: string) =>
    invoke<void>("fullscreen_external_window", { id, appId, title }),
  closeExternalWindow: (id: string, appId: string, title: string) =>
    invoke<void>("close_external_window", { id, appId, title }),
  launchSystemApp: (kind: SystemAppKind) => invoke<void>("launch_system_app", { kind }),
  listDesktopApps: () =>
    invoke<{ id: string; name: string; iconDataUrl: string | null; comment: string | null }[]>(
      "list_desktop_apps",
    ),
  launchDesktopApp: (id: string) => invoke<void>("launch_desktop_app", { id }),
  createTopic: (args: {
    title: string;
    engine: string;
    workdir: string;
    model: string | null;
    dangerMode: boolean;
  }) => invoke<Topic>("create_topic", args),
  // v1.17.0: "+ 新建" quick-path — no workdir prompt, SalmonApp owns the
  // scratch directory under app_data_dir/topics/<topic_id>/. Returned
  // Topic has isScratch=true so the list pill and delete cleanup hook
  // know about it.
  createQuickTopic: (args?: { title?: string | null; engine?: string | null }) =>
    invoke<Topic>("create_quick_topic", {
      title: args?.title ?? null,
      engine: args?.engine ?? null,
    }),
  appendSystemMessage: (topicId: string, content: string) =>
    invoke<Message>("append_system_message", { topicId, content }),
  listTopics: () => invoke<Topic[]>("list_topics"),
  deleteTopic: (id: string) => invoke<void>("delete_topic", { id }),
  renameTopic: (id: string, title: string) =>
    invoke<void>("rename_topic", { id, title }),
  openTopic: (id: string) => invoke<void>("open_topic", { id }),
  sendMessage: (topicId: string, content: string) =>
    invoke<Message>("send_message", { topicId, content }),
  continueWithLocalContext: (topicId: string, content: string) =>
    invoke<Message>("continue_with_local_context", { topicId, content }),
  interruptTopic: (topicId: string) =>
    invoke<void>("interrupt_topic", { topicId }),
  approvePermission: (topicId: string, requestId: string, allow: boolean) =>
    invoke<void>("approve_permission", { topicId, requestId, allow }),
  listMessages: (topicId: string) =>
    invoke<Message[]>("list_messages", { topicId }),
  searchMessages: (query: string, limit = 30) =>
    invoke<SearchResult[]>("search_messages", { query, limit }),
  searchTopicMessages: (topicId: string, query: string, limit = 50) =>
    invoke<SearchResult[]>("search_topic_messages", { topicId, query, limit }),
  listWorkdirFiles: (workdir: string) =>
    invoke<FileEntry[]>("list_workdir_files", { workdir }),
  readFileText: (path: string) => invoke<string>("read_file_text", { path }),
  renderOfficePreview: (path: string) =>
    invoke<string[]>("render_office_preview", { path }),
  suggestTopicTitle: (id: string) =>
    invoke<string>("suggest_topic_title", { id }),
  getDefaultEngine: () => invoke<string>("get_default_engine"),
  setDefaultEngine: (engine: string) =>
    invoke<void>("set_default_engine", { engine }),
  getNotifySound: () => invoke<boolean>("get_notify_sound"),
  setNotifySound: (enabled: boolean) =>
    invoke<void>("set_notify_sound", { enabled }),
  // v1.20: Ubuntu Desktop shell toggle. null = user never set (App.tsx
  // falls back to platform default — on for Linux, off elsewhere).
  getDesktopMode: () => invoke<boolean | null>("get_desktop_mode"),
  setDesktopMode: (enabled: boolean) =>
    invoke<void>("set_desktop_mode", { enabled }),
  getDesktopAppearance: () =>
    invoke<{
      wallpaper: "horizon" | "aurora" | "ubuntu" | "deep" | "salmon" | "image";
      wallpaperPath: string | null;
      wallpaperFit: "cover" | "contain" | "fill" | "center";
      theme: "system" | "dark" | "light";
      accent: "salmon" | "blue" | "green" | "purple";
      slideshowMinutes: 0 | 5 | 15 | 30 | 60;
      gtkTheme: string | null;
      iconTheme: string | null;
      cursorTheme: string | null;
      interfaceFontFamily: string | null;
      documentFontFamily: string | null;
      monospaceFontFamily: string | null;
      textScalingFactor: number;
      gtkThemes: string[];
      iconThemes: string[];
      cursorThemes: string[];
      fontFamilies: string[];
      monospaceFontFamilies: string[];
    }>("get_desktop_appearance"),
  setDesktopWallpaper: (wallpaper: "horizon" | "aurora" | "ubuntu" | "deep" | "salmon") =>
    invoke<void>("set_desktop_wallpaper", { wallpaper }),
  setDesktopWallpaperImage: (path: string) =>
    invoke<{
      wallpaper: "image";
      wallpaperPath: string | null;
      wallpaperFit: "cover" | "contain" | "fill" | "center";
      theme: "system" | "dark" | "light";
      accent: "salmon" | "blue" | "green" | "purple";
      slideshowMinutes: 0 | 5 | 15 | 30 | 60;
      gtkTheme: string | null;
      iconTheme: string | null;
      cursorTheme: string | null;
      interfaceFontFamily: string | null;
      documentFontFamily: string | null;
      monospaceFontFamily: string | null;
      textScalingFactor: number;
      gtkThemes: string[];
      iconThemes: string[];
      cursorThemes: string[];
      fontFamilies: string[];
      monospaceFontFamilies: string[];
    }>("set_desktop_wallpaper_image", { path }),
  setDesktopWallpaperFit: (fit: "cover" | "contain" | "fill" | "center") =>
    invoke<void>("set_desktop_wallpaper_fit", { fit }),
  setDesktopWallpaperSlideshow: (minutes: 0 | 5 | 15 | 30 | 60) =>
    invoke<void>("set_desktop_wallpaper_slideshow", { minutes }),
  setDesktopTheme: (theme: "system" | "dark" | "light") =>
    invoke<void>("set_desktop_theme", { theme }),
  setDesktopAccent: (accent: "salmon" | "blue" | "green" | "purple") =>
    invoke<void>("set_desktop_accent", { accent }),
  setDesktopGtkTheme: (theme: string) => invoke<void>("set_desktop_gtk_theme", { theme }),
  setDesktopIconTheme: (theme: string) => invoke<void>("set_desktop_icon_theme", { theme }),
  setDesktopCursorTheme: (theme: string) => invoke<void>("set_desktop_cursor_theme", { theme }),
  setDesktopFontFamily: (kind: "interface" | "document" | "monospace", family: string) =>
    invoke<void>("set_desktop_font_family", { kind, family }),
  setDesktopTextScalingFactor: (factor: number) =>
    invoke<void>("set_desktop_text_scaling_factor", { factor }),
  getChatLayout: () => invoke<string>("get_chat_layout"),
  setChatLayout: (layout: string) =>
    invoke<void>("set_chat_layout", { layout }),
  getComposerSendMode: () => invoke<ComposerSendMode>("get_composer_send_mode"),
  setComposerSendMode: (mode: ComposerSendMode) =>
    invoke<void>("set_composer_send_mode", { mode }),
  setArchived: (id: string, archived: boolean) =>
    invoke<void>("set_archived", { id, archived }),
  checkWorkdir: (path: string) =>
    invoke<WorkdirCheck>("check_workdir", { path }),
  generateRecommendations: () =>
    invoke<Recommendation[]>("generate_recommendations"),
  listPendingRecommendations: () =>
    invoke<Recommendation[]>("list_pending_recommendations"),
  listRecentRecommendations: (limit: number) =>
    invoke<Recommendation[]>("list_recent_recommendations", { limit }),
  decideRecommendation: (id: string, decision: "accepted" | "ignored") =>
    invoke<void>("decide_recommendation", { id, decision }),
  setDangerMode: (id: string, danger: boolean) =>
    invoke<void>("set_danger_mode", { id, danger }),
  runningTopics: () => invoke<string[]>("running_topics"),
  resetTopicSession: (id: string) =>
    invoke<void>("reset_topic_session", { id }),
  debugLog: (message: string) => invoke<void>("debug_log", { message }),
  getHomeDir: () => invoke<string>("get_home_dir"),
  listDesktopItems: () => invoke<FileEntry[]>("list_desktop_items"),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  createDesktopFolder: (name?: string | null) =>
    invoke<FileEntry>("create_desktop_folder", { name: name ?? null }),
  createDesktopFile: (name?: string | null) =>
    invoke<FileEntry>("create_desktop_file", { name: name ?? null }),
  renameDesktopItem: (path: string, newName: string) =>
    invoke<FileEntry>("rename_desktop_item", { path, newName }),
  trashPath: (path: string) => invoke<void>("trash_path", { path }),
  openTrash: () => invoke<void>("open_trash"),
  emptyTrash: () => invoke<void>("empty_trash"),
  addTopicUsage: (topicId: string, inputTokens: number, outputTokens: number) =>
    invoke<void>("add_topic_usage", { topicId, inputTokens, outputTokens }),
  setTopicTurnDuration: (topicId: string, durationMs: number) =>
    invoke<void>("set_topic_turn_duration", { topicId, durationMs }),
  getUsageSummary: () => invoke<UsageSummary>("get_usage_summary"),
  getAppDataDir: () => invoke<string>("get_app_data_dir"),
  // ── v0.9.0-alpha.2: mail ────────────────────────────────────────────
  getOauthConfigPath: () => invoke<string>("get_oauth_config_path"),
  getOauthStatus: () => invoke<OauthStatus>("get_oauth_status"),
  listMailAccounts: () => invoke<MailAccount[]>("list_mail_accounts"),
  startGmailOauth: () => invoke<MailAccount>("start_gmail_oauth"),
  syncMailAccount: (accountId: string) =>
    invoke<number>("sync_mail_account", { accountId }),
  listInboxMessages: (accountId: string, limit?: number) =>
    invoke<MailListItem[]>("list_inbox_messages", { accountId, limit: limit ?? null }),
  searchMailMessages: (query: string, accountId?: string | null, limit = 20) =>
    invoke<MailListItem[]>("search_mail_messages", { query, accountId: accountId ?? null, limit }),
  listThreadMail: (threadId: string, limit = 50) =>
    invoke<MailListItem[]>("list_thread_mail", { threadId, limit }),
  listContactMail: (accountId: string, email: string, limit = 50) =>
    invoke<MailListItem[]>("list_contact_mail", { accountId, email, limit }),
  // v1.1.1: batch lookup mail rows by id — powers the related-mail
  // expand on brief cards. Returns rows in the same order as `ids`;
  // missing rows are silently dropped (mail deleted / outside sync window).
  getMailMessagesByIds: (ids: string[]) =>
    invoke<MailListItem[]>("get_mail_messages_by_ids", { ids }),
  listContactBriefItems: (email: string) =>
    invoke<BriefItem[]>("list_contact_brief_items", { email }),
  getMailMessage: (messageId: string) =>
    invoke<MailMessageFull>("get_mail_message", { messageId }),
  deleteMailAccount: (accountId: string) =>
    invoke<void>("delete_mail_account", { accountId }),
  // v1.17.1: forcibly drop any half-finished OAuth flow before launching
  // a fresh add-account attempt. Belt-and-suspenders against the
  // "another OAuth attempt is already in progress" sticky-state bug.
  cancelPendingOauth: () => invoke<void>("cancel_pending_oauth"),
  // ── v0.9.0-alpha.3: send / draft / mark-read ────────────────────────
  startOutlookOauth: () => invoke<MailAccount>("start_outlook_oauth"),
  sendMail: (input: ComposeInput) =>
    invoke<string>("send_mail", { input }),
  saveMailDraft: (input: ComposeInput, draftId?: string | null) =>
    invoke<string>("save_mail_draft", { input, draftId: draftId ?? null }),
  markMailRead: (messageId: string, read: boolean) =>
    invoke<void>("mark_mail_read", { messageId, read }),
  setMailStar: (messageId: string, starred: boolean) =>
    invoke<void>("set_mail_star", { messageId, starred }),
  archiveMail: (messageId: string) =>
    invoke<void>("archive_mail", { messageId }),
  forwardMail: (input: { messageId: string; to: string[]; cc?: string[] | null; bodyPrefix?: string | null }) =>
    invoke<string>("forward_mail", {
      messageId: input.messageId,
      to: input.to,
      cc: input.cc ?? null,
      bodyPrefix: input.bodyPrefix ?? null,
    }),
  // ── v0.9.0-alpha.5: calendar ────────────────────────────────────────
  syncCalendar: (accountId: string) =>
    invoke<number>("sync_calendar", { accountId }),
  listCalendarEvents: (startMs: number, endMs: number) =>
    invoke<CalEvent[]>("list_calendar_events", { startMs, endMs }),
  createCalendarEvent: (input: {
    accountId: string;
    title: string;
    startMs: number;
    endMs: number;
    allDay: boolean;
    location: string | null;
  }) => invoke<CalEvent>("create_calendar_event", { input }),
  updateCalendarEvent: (input: {
    accountId: string;
    eventId: string;
    title?: string | null;
    startMs?: number | null;
    endMs?: number | null;
    allDay?: boolean | null;
    location?: string | null;
  }) => invoke<CalEvent>("update_calendar_event", {
    input: {
      accountId: input.accountId,
      eventId: input.eventId,
      title: input.title ?? null,
      startMs: input.startMs ?? null,
      endMs: input.endMs ?? null,
      allDay: input.allDay ?? null,
      location: input.location ?? null,
    },
  }),
  deleteCalendarEvent: (accountId: string, eventId: string) =>
    invoke<void>("delete_calendar_event", { accountId, eventId }),
  // ── v0.9.1: Tasks ───────────────────────────────────────────────────
  syncTasks: (accountId: string) =>
    invoke<number>("sync_tasks", { accountId }),
  listTasks: (accountId?: string | null, includeCompleted?: boolean) =>
    invoke<Task[]>("list_tasks", {
      accountId: accountId ?? null,
      includeCompleted: includeCompleted ?? true,
    }),
  createTask: (input: CreateTaskInput) =>
    invoke<Task>("create_task", { input }),
  updateTask: (input: UpdateTaskInput) =>
    invoke<Task>("update_task", { input }),
  deleteTask: (taskId: string) =>
    invoke<void>("delete_task", { taskId }),
  // ── v0.9.0-alpha.6: contacts ────────────────────────────────────────
  syncContacts: (accountId: string) =>
    invoke<number>("sync_contacts", { accountId }),
  listContacts: (accountId?: string | null) =>
    invoke<ContactRow[]>("list_contacts", { accountId: accountId ?? null }),
  // v1.1: top-level Contacts tab data source. Includes strangers + Pulse
  // priority counts. See `UnifiedContact` in types.ts.
  listUnifiedContacts: (accountId?: string | null) =>
    invoke<UnifiedContact[]>("list_unified_contacts", { accountId: accountId ?? null }),
  // v1.1: per-contact 30-day Roost bundle (what Pulse was fed).
  getContactRoostBundle: (email: string) =>
    invoke<ContactBundle | null>("get_contact_roost_bundle", { email }),
  setContactVip: (contactId: string, vip: boolean) =>
    invoke<void>("set_contact_vip", { contactId, vip }),
  setContactNote: (contactId: string, note: string | null) =>
    invoke<void>("set_contact_note", { contactId, note }),
  getContactNote: (contactId: string) =>
    invoke<string | null>("get_contact_note", { contactId }),
  // ── v0.9.0-alpha.6: home feed (heuristic, kept as fallback) ────────
  buildHomeFeed: () => invoke<BriefingFeed>("build_home_feed"),
  // ── v0.9.1: LLM briefing pipeline ───────────────────────────────────
  getBriefingStatus: () => invoke<BriefingStatus>("get_briefing_status"),
  runBriefing: () => invoke<BriefingRunResult>("run_briefing"),
  listBriefItems: (briefingId?: string | null) =>
    invoke<BriefItem[]>("list_brief_items", { briefingId: briefingId ?? null }),
  listBriefHistory: (limit?: number | null) =>
    invoke<BriefItem[]>("list_brief_history", { limit: limit ?? 200 }),
  executeActionStep: (input: ExecuteStepInput) =>
    invoke<StepResult[]>("execute_action_step", { input }),
  decideBriefItem: (itemId: string, status: "acted" | "ack" | "muted" | "pending") =>
    invoke<void>("decide_brief_item", { itemId, status }),
  getRubric: () => invoke<string>("get_rubric"),
  setRubric: (content: string) => invoke<void>("set_rubric", { content }),
  maybeEditRubric: () => invoke<boolean>("maybe_edit_rubric"),
};
