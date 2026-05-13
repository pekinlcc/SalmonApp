import { invoke } from "@tauri-apps/api/core";
import type { BriefingFeed, BriefingRunResult, BriefingStatus, BriefItem, CalEvent, CliInfo, ComposeInput, ComposerSendMode, ContactBundle, ContactRow, CreateTaskInput, ExecuteStepInput, FileEntry, MailAccount, MailListItem, MailMessageFull, Message, OauthStatus, Recommendation, SearchResult, StepResult, Task, Topic, UnifiedContact, UpdateTaskInput, UsageSummary, WorkdirCheck } from "./types";

export const api = {
  detectClis: () => invoke<{ clis: CliInfo[] }>("detect_clis"),
  openLink: (workdir: string, href: string) =>
    invoke<void>("open_link", { workdir, href }),
  createTopic: (args: {
    title: string;
    engine: string;
    workdir: string;
    model: string | null;
    dangerMode: boolean;
  }) => invoke<Topic>("create_topic", args),
  listTopics: () => invoke<Topic[]>("list_topics"),
  deleteTopic: (id: string) => invoke<void>("delete_topic", { id }),
  renameTopic: (id: string, title: string) =>
    invoke<void>("rename_topic", { id, title }),
  openTopic: (id: string) => invoke<void>("open_topic", { id }),
  sendMessage: (topicId: string, content: string) =>
    invoke<Message>("send_message", { topicId, content }),
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
  addTopicUsage: (topicId: string, inputTokens: number, outputTokens: number) =>
    invoke<void>("add_topic_usage", { topicId, inputTokens, outputTokens }),
  setTopicTurnDuration: (topicId: string, durationMs: number) =>
    invoke<void>("set_topic_turn_duration", { topicId, durationMs }),
  getUsageSummary: () => invoke<UsageSummary>("get_usage_summary"),
  getAppDataDir: () => invoke<string>("get_app_data_dir"),
  // ── v0.9.0-alpha.2: mail ────────────────────────────────────────────
  getOauthStatus: () => invoke<OauthStatus>("get_oauth_status"),
  listMailAccounts: () => invoke<MailAccount[]>("list_mail_accounts"),
  startGmailOauth: () => invoke<MailAccount>("start_gmail_oauth"),
  syncMailAccount: (accountId: string) =>
    invoke<number>("sync_mail_account", { accountId }),
  listInboxMessages: (accountId: string, limit?: number) =>
    invoke<MailListItem[]>("list_inbox_messages", { accountId, limit: limit ?? null }),
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
  // ── v0.9.0-alpha.3: send / draft / mark-read ────────────────────────
  startOutlookOauth: () => invoke<MailAccount>("start_outlook_oauth"),
  sendMail: (input: ComposeInput) =>
    invoke<string>("send_mail", { input }),
  saveMailDraft: (input: ComposeInput, draftId?: string | null) =>
    invoke<string>("save_mail_draft", { input, draftId: draftId ?? null }),
  markMailRead: (messageId: string, read: boolean) =>
    invoke<void>("mark_mail_read", { messageId, read }),
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
  // ── v0.9.0-alpha.6: home feed (heuristic, kept as fallback) ────────
  buildHomeFeed: () => invoke<BriefingFeed>("build_home_feed"),
  // ── v0.9.1: LLM briefing pipeline ───────────────────────────────────
  getBriefingStatus: () => invoke<BriefingStatus>("get_briefing_status"),
  runBriefing: () => invoke<BriefingRunResult>("run_briefing"),
  listBriefItems: (briefingId?: string | null) =>
    invoke<BriefItem[]>("list_brief_items", { briefingId: briefingId ?? null }),
  executeActionStep: (input: ExecuteStepInput) =>
    invoke<StepResult[]>("execute_action_step", { input }),
  decideBriefItem: (itemId: string, status: "acted" | "ack" | "muted" | "pending") =>
    invoke<void>("decide_brief_item", { itemId, status }),
  getRubric: () => invoke<string>("get_rubric"),
  setRubric: (content: string) => invoke<void>("set_rubric", { content }),
  maybeEditRubric: () => invoke<boolean>("maybe_edit_rubric"),
};
