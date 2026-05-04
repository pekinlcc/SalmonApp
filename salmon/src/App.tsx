import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Block, ChatLayout, CliInfo, Message, Recommendation, StreamEvent, ToolCall, Topic, UiMessage } from "./lib/types";
import { api } from "./lib/api";
import { LeftSidebar } from "./components/LeftSidebar";
import { ChatStream } from "./components/ChatStream";
import { Composer } from "./components/Composer";
import { RightPane } from "./components/RightPane";
import { NewTopicDialog } from "./components/NewTopicDialog";
import { Onboarding } from "./components/Onboarding";
import { SettingsDialog } from "./components/SettingsDialog";
import { WelcomeBack } from "./components/WelcomeBack";

interface PendingPerm {
  id: string;
  tool: string;
  input: any;
  command: string | null;
}

export default function App() {
  const [cliStatus, setCliStatus] = useState<CliInfo[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [defaultEngine, setDefaultEngine] = useState<string>("claude");
  const [chatLayout, setChatLayout] = useState<ChatLayout>("thinking");
  const [showSettings, setShowSettings] = useState(false);
  const [workdirOkByTopic, setWorkdirOkByTopic] = useState<Record<string, boolean>>({});
  const [lastReadAt, setLastReadAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("salmon.lastReadAt") || "{}"); } catch { return {}; }
  });
  const markRead = useCallback((id: string) => {
    setLastReadAt((m) => {
      const next = { ...m, [id]: Date.now() };
      try { localStorage.setItem("salmon.lastReadAt", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);
  const lastRecsRunRef = useRef<number>(0);

  const refreshRecsList = useCallback(async () => {
    try {
      const list = await api.listPendingRecommendations();
      setRecommendations(list);
    } catch (e: any) {
      api.debugLog(`list recommendations failed: ${e}`);
    }
  }, []);

  const generateRecs = useCallback(async () => {
    if (recsLoading) return;
    setRecsLoading(true);
    setRecsError(null);
    lastRecsRunRef.current = Date.now();
    try {
      await api.generateRecommendations();
      await refreshRecsList();
    } catch (e: any) {
      setRecsError(String(e));
    } finally {
      setRecsLoading(false);
    }
  }, [recsLoading, refreshRecsList]);

  const onDecideRec = useCallback(async (id: string, decision: "accepted" | "ignored") => {
    setRecommendations((cur) => cur.filter((r) => r.id !== id));
    try {
      await api.decideRecommendation(id, decision);
    } catch (e: any) {
      api.debugLog(`decide failed: ${e}`);
      await refreshRecsList();
    }
  }, [refreshRecsList]);

  // Trigger rule: only when there's been new topic activity since last run,
  // AND fire on the next hour boundary (HH:00). On launch, if it's been ≥1h
  // since last run AND there's new activity, fire immediately so the home
  // page isn't stale; otherwise wait for the next hour mark.
  const topicsRef = useRef(topics);
  topicsRef.current = topics;
  useEffect(() => {
    refreshRecsList();
    const HOUR = 60 * 60 * 1000;
    const maxTopicUpdated = () =>
      topicsRef.current.reduce((m, t) => Math.max(m, t.updatedAt), 0);
    const readLast = () =>
      parseInt(localStorage.getItem("salmon.lastRecsRun") || "0", 10);
    const writeLast = () => {
      try { localStorage.setItem("salmon.lastRecsRun", String(Date.now())); } catch {}
    };

    const lastRun = readLast();
    if (Date.now() - lastRun > HOUR && maxTopicUpdated() > lastRun) {
      generateRecs().then(writeLast);
    }

    let lastFiredHour = -1;
    const tick = () => {
      const now = new Date();
      if (now.getMinutes() !== 0) return;            // only on HH:00
      if (now.getHours() === lastFiredHour) return;  // de-dupe within the minute
      const last = readLast();
      if (maxTopicUpdated() <= last) return;          // no new activity
      lastFiredHour = now.getHours();
      generateRecs().then(writeLast);
    };
    const timer = setInterval(tick, 30 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("salmon.rightCollapsed") === "1"; } catch { return false; }
  });
  const toggleRight = useCallback(() => {
    setRightCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("salmon.rightCollapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        toggleRight();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRight]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const [messagesByTopic, setMessagesByTopic] = useState<Record<string, UiMessage[]>>({});
  const [logsByTopic, setLogsByTopic] = useState<Record<string, string[]>>({});
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [spawningId, setSpawningId] = useState<string | null>(null);
  const [busyByTopic, setBusyByTopic] = useState<Record<string, boolean>>({});
  const [pendingPermByTopic, setPendingPermByTopic] = useState<Record<string, PendingPerm | null>>({});
  const [errorByTopic, setErrorByTopic] = useState<Record<string, string | null>>({});
  const [selectedTool, setSelectedTool] = useState<ToolCall | null>(null);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === selectedId) || null,
    [topics, selectedId]
  );

  // Initial load: detect CLIs and topics
  const refresh = useCallback(async () => {
    const det = await api.detectClis();
    setCliStatus(det.clis);
    const ts = await api.listTopics();
    setTopics(ts);
    const running = await api.runningTopics();
    setRunningIds(new Set(running));
    try {
      const eng = await api.getDefaultEngine();
      setDefaultEngine(eng);
    } catch {}
    try {
      const layout = await api.getChatLayout();
      if (layout === "inline" || layout === "thinking") setChatLayout(layout);
    } catch {}
    return { clis: det.clis, topics: ts };
  }, []);

  const onChangeChatLayout = useCallback(async (layout: ChatLayout) => {
    setChatLayout(layout);
    try {
      await api.setChatLayout(layout);
    } catch (e) {
      api.debugLog(`set_chat_layout failed: ${e}`);
    }
  }, []);

  const onChangeDefaultEngine = useCallback(async (engine: string) => {
    setDefaultEngine(engine);
    try {
      await api.setDefaultEngine(engine);
    } catch (e) {
      api.debugLog(`set_default_engine failed: ${e}`);
    }
  }, []);

  useEffect(() => {
    refresh().then(({ clis, topics }) => {
      const ready = clis.some((c) => c.installed && c.loggedIn);
      if (ready && topics.length > 0) {
        setShowOnboarding(false);
      } else if (ready && topics.length === 0) {
        setShowOnboarding(false);
      } else {
        setShowOnboarding(true);
      }
    });
    // expose home for path shortening
    (window as any).__SALMON_HOME__ = "";
  }, [refresh]);

  // Subscribe to stream events
  useEffect(() => {
    let un: UnlistenFn | undefined;
    api.debugLog("registering salmon-stream listener");
    listen<StreamEvent>("salmon-stream", (event) => {
      const k = (event.payload as any)?.kind;
      api.debugLog(`recv ${k} for topic=${(event.payload as any)?.topicId}`);
      handleStream(event.payload);
    })
      .then((u) => {
        un = u;
        api.debugLog("listener registered OK");
      })
      .catch((e) => api.debugLog(`listener register FAILED: ${e}`));
    return () => {
      un?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStream = (e: StreamEvent) => {
    switch (e.kind) {
      case "started":
        setRunningIds((s) => new Set(s).add(e.topicId));
        setSpawningId((cur) => (cur === e.topicId ? null : cur));
        if (e.sessionId) {
          // could persist via topic refresh
        }
        break;
      case "assistantDone": {
        if (selectedIdRef.current === e.topicId) {
          markRead(e.topicId);
        }
        setMessagesByTopic((m) => {
          const list = [...(m[e.topicId] || [])];
          let cur = list[list.length - 1];
          if (!cur || cur.role !== "assistant" || !cur.pending) {
            cur = newAssistantMessage(e.messageId || cryptoId());
            list.push(cur);
          }
          cur.blocks = [
            ...cur.blocks,
            { kind: "text", content: e.content, createdAt: Date.now() },
          ];
          cur.content = (cur.content ? cur.content + "\n\n" : "") + e.content;
          return { ...m, [e.topicId]: list };
        });
        setBusyByTopic((b) => ({ ...b, [e.topicId]: true }));
        break;
      }
      case "toolCall": {
        setMessagesByTopic((m) => {
          const list = [...(m[e.topicId] || [])];
          let cur = list[list.length - 1];
          if (!cur || cur.role !== "assistant" || !cur.pending) {
            cur = newAssistantMessage(cryptoId());
            list.push(cur);
          }
          cur.blocks = [
            ...cur.blocks,
            { kind: "tool", tool: e.tool, createdAt: Date.now() },
          ];
          cur.tools = [...cur.tools, e.tool];
          return { ...m, [e.topicId]: list };
        });
        break;
      }
      case "toolResult": {
        setMessagesByTopic((m) => {
          const list = [...(m[e.topicId] || [])];
          for (const msg of list) {
            for (const t of msg.tools) {
              if (t.id === e.toolId) {
                t.state = (e.state as any) || "done";
                t.result = e.result || null;
              }
            }
            msg.blocks = msg.blocks.map((b) =>
              b.kind === "tool" && b.tool.id === e.toolId
                ? {
                    ...b,
                    tool: {
                      ...b.tool,
                      state: (e.state as any) || "done",
                      result: e.result || null,
                    },
                  }
                : b
            );
          }
          return { ...m, [e.topicId]: list };
        });
        setFilesRefreshKey((k) => k + 1);
        break;
      }
      case "permissionRequest":
        setPendingPermByTopic((p) => ({
          ...p,
          [e.topicId]: { id: e.requestId, tool: e.tool, input: e.input, command: e.command },
        }));
        break;
      case "error":
        setErrorByTopic((er) => ({ ...er, [e.topicId]: e.message }));
        setBusyByTopic((b) => ({ ...b, [e.topicId]: false }));
        break;
      case "exited":
        setBusyByTopic((b) => ({ ...b, [e.topicId]: false }));
        // Mark current pending assistant as done
        setMessagesByTopic((m) => {
          const list = [...(m[e.topicId] || [])];
          for (const msg of list) {
            if (msg.role === "assistant" && msg.pending) {
              msg.pending = false;
            }
          }
          return { ...m, [e.topicId]: list };
        });
        // notify if user not on this topic
        if (selectedIdRef.current !== e.topicId) {
          maybeNotify(e.topicId);
        }
        setFilesRefreshKey((k) => k + 1);
        maybeAutoTitle(e.topicId);
        break;
      case "log":
        setLogsByTopic((lg) => {
          const arr = [...(lg[e.topicId] || []), e.line];
          return { ...lg, [e.topicId]: arr.slice(-1000) };
        });
        break;
      default:
        break;
    }
  };

  const titleAttemptedRef = useRef<Set<string>>(new Set());
  const maybeAutoTitle = (topicId: string) => {
    if (titleAttemptedRef.current.has(topicId)) return;
    setTopics((cur) => {
      const t = cur.find((x) => x.id === topicId);
      if (!t) return cur;
      const isDefault = t.title === "新建 Topic" || t.title.trim() === "";
      if (!isDefault) return cur;
      titleAttemptedRef.current.add(topicId);
      api
        .suggestTopicTitle(topicId)
        .then((newTitle) => {
          setTopics((cs) => cs.map((x) => (x.id === topicId ? { ...x, title: newTitle } : x)));
        })
        .catch((e) => {
          api.debugLog(`auto-title failed for ${topicId}: ${e}`);
        });
      return cur;
    });
  };

  const maybeNotify = async (topicId: string) => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (!granted) return;
      const t = topics.find((x) => x.id === topicId);
      sendNotification({ title: "Salmon", body: `Topic 完成：${t?.title || topicId}` });
    } catch {}
  };

  const onSelect = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setSelectedTool(null);
      markRead(id);
      // Check workdir up front so we can show a proper banner instead of
      // letting the CLI fail with a cryptic exit code on first send.
      const t = topics.find((x) => x.id === id);
      if (t) {
        try {
          const chk = await api.checkWorkdir(t.workdir);
          setWorkdirOkByTopic((m) => ({ ...m, [id]: chk.exists && chk.isDir }));
        } catch {
          setWorkdirOkByTopic((m) => ({ ...m, [id]: false }));
        }
      }
      if (!messagesByTopic[id]) {
        try {
          const msgs = await api.listMessages(id);
          setMessagesByTopic((m) => ({ ...m, [id]: hydrate(msgs) }));
        } catch {}
      }
      if (!runningIds.has(id)) {
        setSpawningId(id);
        try {
          await api.openTopic(id);
        } catch (e: any) {
          setErrorByTopic((er) => ({ ...er, [id]: String(e) }));
          setSpawningId(null);
        }
      }
    },
    [messagesByTopic, runningIds, topics]
  );

  const onArchive = useCallback(async (id: string, archived: boolean) => {
    try {
      await api.setArchived(id, archived);
      setTopics((cur) =>
        cur.map((t) => (t.id === id ? { ...t, archived } : t))
      );
      if (archived && selectedIdRef.current === id) {
        setSelectedId(null);
      }
    } catch (e: any) {
      api.debugLog(`set_archived failed: ${e}`);
    }
  }, []);

  const onCreateTopic = useCallback(
    async (args: {
      title: string;
      engine: string;
      workdir: string;
      model: string | null;
      dangerMode: boolean;
    }) => {
      const t = await api.createTopic(args);
      setTopics((cur) => [t, ...cur]);
      setShowNew(false);
      // immediately open
      onSelect(t.id);
    },
    [onSelect]
  );

  const sendToTopic = useCallback(
    async (topicId: string, text: string) => {
      setMessagesByTopic((m) => {
        const list = [...(m[topicId] || [])];
        const now = Date.now();
        list.push({
          id: cryptoId(),
          role: "user",
          content: text,
          blocks: [{ kind: "text", content: text, createdAt: now }],
          tools: [],
          createdAt: now,
        });
        return { ...m, [topicId]: list };
      });
      setBusyByTopic((b) => ({ ...b, [topicId]: true }));
      setErrorByTopic((er) => ({ ...er, [topicId]: null }));
      try {
        await api.sendMessage(topicId, text);
      } catch (e: any) {
        setErrorByTopic((er) => ({ ...er, [topicId]: String(e) }));
        setBusyByTopic((b) => ({ ...b, [topicId]: false }));
      }
    },
    []
  );

  const onSend = useCallback(
    async (text: string) => {
      if (!selectedId) return;
      await sendToTopic(selectedId, text);
    },
    [selectedId, sendToTopic]
  );

  // Click "同意" on a recommendation → jump to its Topic AND auto-send the
  // action_hint as a user message, so the assistant actually starts on it.
  const onAcceptRec = useCallback(
    async (rec: Recommendation) => {
      onDecideRec(rec.id, "accepted");
      if (!rec.topicId) return;
      const text = rec.actionHint?.trim() || rec.title;
      if (!text) return;
      await onSelect(rec.topicId);
      await sendToTopic(rec.topicId, text);
    },
    [onDecideRec, onSelect, sendToTopic]
  );

  const onInterrupt = useCallback(async () => {
    if (!selectedId) return;
    await api.interruptTopic(selectedId);
  }, [selectedId]);

  const onApprove = useCallback(
    async (requestId: string, allow: boolean) => {
      if (!selectedId) return;
      await api.approvePermission(selectedId, requestId, allow);
      setPendingPermByTopic((p) => ({ ...p, [selectedId]: null }));
    },
    [selectedId]
  );

  const onDelete = useCallback(async (id: string) => {
    await api.deleteTopic(id);
    setTopics((cur) => cur.filter((t) => t.id !== id));
    if (selectedIdRef.current === id) setSelectedId(null);
  }, []);

  const onRename = useCallback(async (id: string, title: string) => {
    await api.renameTopic(id, title);
    setTopics((cur) => cur.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  // Quit confirmation when running topics exist
  useEffect(() => {
    const handler = async (e: BeforeUnloadEvent) => {
      if (runningIds.size > 0) {
        e.preventDefault();
        e.returnValue = "";
        const ok = await ask(`还有 ${runningIds.size} 个 Topic 在运行，确认退出？所有运行中的工具调用会被中断。`, {
          title: "退出 Salmon",
          kind: "warning",
        });
        if (!ok) return;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [runningIds]);

  // Onboarding view
  if (showOnboarding) {
    return (
      <Onboarding
        cliStatus={cliStatus}
        onRefresh={refresh}
        onContinue={() => {
          setShowOnboarding(false);
          setShowNew(true);
        }}
      />
    );
  }

  return (
    <div className={`app ${rightCollapsed ? "right-collapsed" : ""}`}>
      <LeftSidebar
        topics={topics}
        selectedId={selectedId}
        runningIds={runningIds}
        spawningId={spawningId}
        cliStatus={cliStatus}
        onSelect={onSelect}
        onHome={() => { setSelectedId(null); setSelectedTool(null); }}
        onNewTopic={() => setShowNew(true)}
        onOpenSettings={() => setShowSettings(true)}
        onDeleteTopic={onDelete}
        onRenameTopic={onRename}
        onArchiveTopic={onArchive}
      />

      {!selectedTopic ? (
        <>
          <section className="middle">
            <WelcomeBack
              topics={topics}
              lastReadAt={lastReadAt}
              pendingPermByTopic={pendingPermByTopic}
              errorByTopic={errorByTopic}
              workdirOkByTopic={workdirOkByTopic}
              recommendations={recommendations}
              recsLoading={recsLoading}
              recsError={recsError}
              onRefreshRecs={generateRecs}
              onDecideRec={onDecideRec}
              onAcceptRec={onAcceptRec}
              onSelect={onSelect}
              onNewTopic={() => setShowNew(true)}
            />
          </section>
          {rightCollapsed ? (
            <RightRail onExpand={toggleRight} />
          ) : (
            <aside className="right">
              <div className="empty" style={{ padding: 30, fontSize: 12 }}>
                （未选中 Topic）
              </div>
            </aside>
          )}
        </>
      ) : (
        <>
          <section className="middle">
            <div className="mid-head">
              <div className="title" onDoubleClick={() => {
                const t2 = window.prompt("重命名", selectedTopic.title);
                if (t2 && t2 !== selectedTopic.title) onRename(selectedTopic.id, t2);
              }}>
                {selectedTopic.title}
              </div>
              <div className="path">{selectedTopic.workdir}</div>
              <span className={`engine-pill ${selectedTopic.engine === "claude" ? "engine-cc" : "engine-cx"}`}>
                {selectedTopic.engine === "claude" ? "Claude Code" : "Codex"}
                {selectedTopic.model ? " · " + selectedTopic.model : ""}
              </span>
              {selectedTopic.dangerMode && <span className="danger">危险模式</span>}
              <div className="spacer" />
              <div className="stat">
                {(messagesByTopic[selectedTopic.id] || []).length} messages
              </div>
            </div>
            <ChatStream
              topic={selectedTopic}
              messages={messagesByTopic[selectedTopic.id] || []}
              pendingPermission={pendingPermByTopic[selectedTopic.id] || null}
              errorBanner={errorByTopic[selectedTopic.id] || null}
              chatLayout={chatLayout}
              workdirMissing={workdirOkByTopic[selectedTopic.id] === false}
              onArchive={() => onArchive(selectedTopic.id, true)}
              onDelete={() => {
                if (window.confirm(`确认删除 Topic "${selectedTopic.title}"?\n（仅删除 Salmon 内的对话记录）`)) {
                  onDelete(selectedTopic.id);
                }
              }}
              onApprovePermission={onApprove}
              onSelectTool={setSelectedTool}
            />
            <Composer
              busy={!!busyByTopic[selectedTopic.id]}
              disabled={workdirOkByTopic[selectedTopic.id] === false}
              onSend={onSend}
              onInterrupt={onInterrupt}
            />
          </section>
          {rightCollapsed ? (
            <RightRail onExpand={toggleRight} />
          ) : (
            <RightPane
              topic={selectedTopic}
              selectedTool={selectedTool}
              logs={logsByTopic[selectedTopic.id] || []}
              refreshKey={filesRefreshKey}
              onCollapse={toggleRight}
            />
          )}
        </>
      )}

      {showNew && (
        <NewTopicDialog
          cliStatus={cliStatus}
          defaultEngine={defaultEngine}
          topics={topics}
          onCancel={() => setShowNew(false)}
          onCreate={onCreateTopic}
        />
      )}

      {showSettings && (
        <SettingsDialog
          chatLayout={chatLayout}
          defaultEngine={defaultEngine}
          cliStatus={cliStatus}
          onChangeChatLayout={onChangeChatLayout}
          onChangeDefaultEngine={onChangeDefaultEngine}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function RightRail({ onExpand }: { onExpand: () => void }) {
  return (
    <aside className="right-rail" title="展开右栏 (Ctrl+\\)" onClick={onExpand}>
      <button className="right-rail-btn">◂</button>
    </aside>
  );
}

function newAssistantMessage(id: string): UiMessage {
  return {
    id,
    role: "assistant",
    content: "",
    blocks: [],
    tools: [],
    pending: true,
    createdAt: Date.now(),
  };
}

function hydrate(msgs: Message[]): UiMessage[] {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    blocks: m.content
      ? [{ kind: "text" as const, content: m.content, createdAt: m.createdAt }]
      : [],
    tools: [],
    createdAt: m.createdAt,
  }));
}
