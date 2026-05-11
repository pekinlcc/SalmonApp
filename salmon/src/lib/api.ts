import { invoke } from "@tauri-apps/api/core";
import type { CliInfo, FileEntry, Message, Recommendation, SearchResult, Topic, UsageSummary, WorkdirCheck } from "./types";

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
  getChatLayout: () => invoke<string>("get_chat_layout"),
  setChatLayout: (layout: string) =>
    invoke<void>("set_chat_layout", { layout }),
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
  debugLog: (message: string) => invoke<void>("debug_log", { message }),
  getHomeDir: () => invoke<string>("get_home_dir"),
  addTopicUsage: (topicId: string, inputTokens: number, outputTokens: number) =>
    invoke<void>("add_topic_usage", { topicId, inputTokens, outputTokens }),
  setTopicTurnDuration: (topicId: string, durationMs: number) =>
    invoke<void>("set_topic_turn_duration", { topicId, durationMs }),
  getUsageSummary: () => invoke<UsageSummary>("get_usage_summary"),
  getAppDataDir: () => invoke<string>("get_app_data_dir"),
};
