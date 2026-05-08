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
}

export type ChatLayout = "inline" | "thinking";

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
