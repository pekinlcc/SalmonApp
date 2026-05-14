export interface Topic {
  id: string;
  title: string;
  engine: string;
  workdir: string;
  model: string | null;
  sessionId: string | null;
  dangerMode: boolean;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkdirCheck {
  exists: boolean;
  isDir: boolean;
  readable: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: any;
  state: "running" | "done" | "cancelled" | "error";
  result: string | null;
}

export interface Message {
  id: string;
  topicId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: any;
  createdAt: number;
  tokenIn?: number | null;
  tokenOut?: number | null;
  durationMs?: number | null;
}

export interface SearchResult {
  topicId: string;
  topicTitle: string;
  engine: string;
  workdir: string;
  messageId: string;
  role: "user" | "assistant" | "system";
  snippet: string;
  createdAt: number;
}

export interface CliInfo {
  name: string;
  binary: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  loggedIn: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export type StreamEvent =
  | { kind: "started"; topicId: string; sessionId: string | null }
  | { kind: "assistantText"; topicId: string; messageId: string; delta: string }
  | { kind: "assistantDone"; topicId: string; messageId: string; content: string }
  | { kind: "usage"; topicId: string; inputTokens: number; outputTokens: number; durationMs: number | null }
  | { kind: "thinking"; topicId: string; messageId: string; content: string }
  | { kind: "toolCall"; topicId: string; tool: ToolCall }
  | { kind: "toolResult"; topicId: string; toolId: string; state: string; result: string | null }
  | { kind: "permissionRequest"; topicId: string; requestId: string; tool: string; input: any; command: string | null }
  | { kind: "error"; topicId: string; message: string }
  | { kind: "exited"; topicId: string; code: number | null }
  | { kind: "sessionEnded"; topicId: string }
  | { kind: "log"; topicId: string; line: string };

export type Block =
  | { kind: "text"; content: string; createdAt: number }
  | { kind: "thinking"; content: string; createdAt: number }
  | { kind: "tool"; tool: ToolCall; createdAt: number };

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  // For backward compatibility (historic messages from DB carry text only here),
  // assistant messages prefer `blocks` for in-order rendering. User messages
  // use `content` only.
  content: string;
  blocks: Block[];
  /** @deprecated Kept for transitional code paths; new code reads `blocks`. */
  tools: ToolCall[];
  pending?: boolean;
  interrupted?: boolean;
  createdAt: number;
  /** Per-turn telemetry, populated when the engine emits Usage / Exited.
   *  Set on the latest assistant turn; user rows leave these undefined. */
  tokenIn?: number;
  tokenOut?: number;
  durationMs?: number;
}

export interface EngineUsage {
  engine: string;
  totalIn: number;
  totalOut: number;
}

export interface TopicUsage {
  topicId: string;
  topicTitle: string;
  engine: string;
  totalIn: number;
  totalOut: number;
}

export interface DailyUsage {
  /** Local YYYY-MM-DD. */
  date: string;
  totalIn: number;
  totalOut: number;
}

// v0.9.0-alpha.2: Gmail integration types.
export interface MailAccount {
  id: string;
  provider: "gmail" | "outlook" | string;
  email: string;
  displayName?: string | null;
  addedAt: number;
  lastSyncAt?: number | null;
  lastSyncError?: string | null;
  unreadCount: number;
}

export interface MailListItem {
  id: string;
  accountId: string;
  threadId?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  subject?: string | null;
  snippet?: string | null;
  dateMs: number;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
}

export interface EmailAddress {
  email: string;
  name?: string | null;
}

export interface MailMessageFull {
  id: string;
  accountId: string;
  threadId?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  toEmails: EmailAddress[];
  ccEmails: EmailAddress[];
  subject?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  dateMs: number;
  unread: boolean;
  starred: boolean;
  labels: string[];
  hasAttachments: boolean;
}

export interface OauthStatus {
  googleConfigured: boolean;
  microsoftConfigured: boolean;
}

export interface MailSyncProgress {
  accountId: string;
  fetched: number;
  total: number;
  stage: "listing" | "fetching" | "done" | string;
}

// v0.9.0-alpha.3+: compose / draft.
export interface ComposeInput {
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  attachmentPaths: string[];
  replyToMessageId: string | null;
}

// v0.9.0-alpha.5: calendar.
export interface CalAttendee {
  email: string;
  name?: string | null;
  response?: string | null;
}
export interface CalEvent {
  id: string;
  accountId: string;
  calendarId?: string | null;
  startMs: number;
  endMs: number;
  allDay: boolean;
  title?: string | null;
  location?: string | null;
  description?: string | null;
  attendees: CalAttendee[];
  organizer?: string | null;
  recurrence?: string | null;
  status?: string | null;
  myResponse?: string | null;
}

// v0.9.0-alpha.6: contacts.
export interface ContactRow {
  id: string;
  accountId: string;
  email: string;
  name?: string | null;
  organization?: string | null;
  isVip: boolean;
  lastSeenMs?: number | null;
  interactionCount: number;
}

// v1.1: union of saved contacts + email-derived "stranger" contacts.
// Strangers are people we've exchanged mail with in the last 30 days
// but haven't synced from Google / Outlook. `isSaved=false` for them;
// their `id` looks like `stranger:<lowercased_email>`. brief* counts
// come from pending brief_items (Pulse output) grouped by priority —
// the frontend sorts the list by
// score = briefHigh*100 + briefMedium*10 + briefLow*1.
export interface UnifiedContact {
  id: string;
  email: string;
  name?: string | null;
  organization?: string | null;
  isVip: boolean;
  isSaved: boolean;
  lastSeenMs?: number | null;
  interactionCount: number;
  accountId?: string | null;
  briefHigh: number;
  briefMedium: number;
  briefLow: number;
}

// v1.1: Roost output (per-contact 30-day local aggregation). Same shape
// the LLM is fed by Pulse, surfaced read-only in the Contacts detail
// panel so users can see exactly what Pulse "knew" about a contact.
export interface BundleMessage {
  id: string;
  accountId: string;
  threadId?: string | null;
  fromMe: boolean;
  subject?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  dateMs: number;
  unread: boolean;
}

export interface BundleEvent {
  id: string;
  title?: string | null;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location?: string | null;
}

export interface ContactBundle {
  email: string;
  displayName?: string | null;
  isVip: boolean;
  interactionCount: number;
  lastSeenMs: number;
  messages: BundleMessage[];
  events: BundleEvent[];
  omittedMessageCount: number;
}

// v0.9.0-alpha.6: home-feed briefing.
export type FeedItem =
  | {
      kind: "Mail";
      id: string;
      accountId: string;
      fromName?: string | null;
      fromEmail?: string | null;
      subject?: string | null;
      snippet?: string | null;
      dateMs: number;
      isVip: boolean;
      score: number;
    }
  | {
      kind: "Event";
      id: string;
      accountId: string;
      startMs: number;
      endMs: number;
      allDay: boolean;
      title?: string | null;
      location?: string | null;
      score: number;
    }
  | {
      kind: "Topic";
      id: string;
      title: string;
      engine: string;
      workdir: string;
      updatedAt: number;
      reason: string;
      score: number;
    }
  | {
      kind: "Recommendation";
      id: string;
      title: string;
      rationale: string;
      actionHint: string;
      priority: string;
      sourceEngine: string;
      score: number;
    };

export interface BriefingFeed {
  generatedAt: number;
  items: FeedItem[];
}

// ============================================================================
// v0.9.1 LLM-driven briefing pipeline (Roost / Pulse / Briefing / Cross-link)
// ============================================================================

export interface ActionStep {
  kind: "reply" | "calendar" | "task" | "acknowledge";
  detail: string;
}

export interface SuggestedAction {
  label: string;
  steps: ActionStep[];
}

export interface BriefItem {
  id: string;
  briefingId: string;
  kind: "mail" | "topic" | "cross" | "event";
  priority: "high" | "medium" | "low";
  title: string;
  summary?: string | null;
  why?: string | null;
  contactEmail?: string | null;
  topicId?: string | null;
  relatedMailIds: string[];
  relatedTopicIds: string[];
  relatedEventIds: string[];
  suggestedActions: SuggestedAction[];
  actionResults: BriefActionRun[];
  status: "pending" | "acted" | "ack" | "muted" | "expired" | "superseded";
  score: number;
  createdAt: number;
  decidedAt?: number | null;
}

export interface BriefActionRun {
  actionIndex: number;
  actionLabel: string;
  createdAt: number;
  results: StepResult[];
}

export interface BriefingStatus {
  currentBriefingId: string | null;
  generatedAt: number | null;
  overview: string | null;
  engineAvailable: boolean;
  engine: string | null;
  rubricPath: string;
}

export interface BriefingRunResult {
  briefingId: string;
  itemCount: number;
  overview: string;
  usedLlm: boolean;
}

export interface BriefingProgress {
  stage: "starting" | "roost" | "pulse" | "briefing" | "cross-link" | "done" | string;
  current: number;
  total: number;
  note?: string | null;
}

export type StepResult =
  | { kind: "Acknowledged"; message: string }
  | { kind: "ReplyDrafted"; draft: string; replyToMailId: string }
  | { kind: "EventCreated"; eventId: string; accountEmail: string; title: string; startMs: number; endMs: number; allDay: boolean; location?: string | null }
  | { kind: "TaskCreated"; taskId: string; accountEmail: string; title: string; dueMs?: number | null; notes?: string | null }
  | { kind: "Skipped"; reason: string };

// v0.9.1: Tasks (Google Tasks + Microsoft Graph Todo)
export interface Task {
  id: string;
  accountId: string;
  listId?: string | null;
  title: string;
  notes?: string | null;
  dueMs?: number | null;
  completed: boolean;
  completedAtMs?: number | null;
  sourceKind: "manual" | "briefing" | "remote" | string;
  sourceBriefItemId?: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface CreateTaskInput {
  accountId: string;
  title: string;
  notes?: string | null;
  dueMs?: number | null;
  sourceKind?: string | null;
  sourceBriefItemId?: string | null;
}
export interface UpdateTaskInput {
  id: string;
  completed?: boolean | null;
  title?: string | null;
  notes?: string | null;
  dueMs?: number | null;
}

export interface ExecuteStepInput {
  itemId: string;
  actionIndex: number;
  stepIndices?: number[] | null;
}

export interface UsageSummary {
  todayIn: number;
  todayOut: number;
  weekIn: number;
  weekOut: number;
  monthIn: number;
  monthOut: number;
  totalIn: number;
  totalOut: number;
  byEngine: EngineUsage[];
  byTopic: TopicUsage[];
  /** 30 entries oldest → newest, zero-filled for days with no activity. */
  daily30: DailyUsage[];
}

export type ChatLayout = "inline" | "thinking";
export type ComposerSendMode = "modEnter" | "enter";

export interface Recommendation {
  id: string;
  sourceEngine: string;
  topicId: string | null;
  title: string;
  rationale: string;
  actionHint: string;
  payoff: string;
  status: "pending" | "accepted" | "ignored" | "expired";
  priority: "high" | "medium" | "low";
  selfValue: "high" | "medium" | "low" | null;
  peerValue: "high" | "medium" | "low" | null;
  generatedAt: number;
  decidedAt: number | null;
  decisionReason: string | null;
}
