import { invoke } from "@tauri-apps/api/core";
import type { CliInfo, FileEntry, Message, Topic } from "./types";

export const api = {
  detectClis: () => invoke<{ clis: CliInfo[] }>("detect_clis"),
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
  setDangerMode: (id: string, danger: boolean) =>
    invoke<void>("set_danger_mode", { id, danger }),
  runningTopics: () => invoke<string[]>("running_topics"),
  debugLog: (message: string) => invoke<void>("debug_log", { message }),
};
