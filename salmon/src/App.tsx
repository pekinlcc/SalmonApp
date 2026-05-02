import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { ask } from "@tauri-apps/plugin-dialog";
import type { CliInfo, Message, StreamEvent, ToolCall, Topic, UiMessage } from "./lib/types";
import { api } from "./lib/api";
import { LeftSidebar } from "./components/LeftSidebar";
import { ChatStream } from "./components/ChatStream";
import { Composer } from "./components/Composer";
import { RightPane } from "./components/RightPane";
import { NewTopicDialog } from "./components/NewTopicDialog";
import { Onboarding } from "./components/Onboarding";

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
    return { clis: det.clis, topics: ts };
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
        setMessagesByTopic((m) => {
          const list = [...(m[e.topicId] || [])];
          // try to merge into a "current assistant" message; else append new
          let cur = list[list.length - 1];
          if (!cur || cur.role !== "assistant" || !cur.pending) {
            cur = {
              id: e.messageId || cryptoId(),
              role: "assistant",
              content: "",
              tools: [],
              pending: true,
              createdAt: Date.now(),
            };
            list.push(cur);
          }
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
            cur = {
              id: cryptoId(),
              role: "assistant",
              content: "",
              tools: [],
              pending: true,
              createdAt: Date.now(),
            };
            list.push(cur);
          }
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
          }
          return { ...m, [e.topicId]: list };
        });
        // refresh files panel
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
      // Lazy spawn + load history if not loaded
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
    [messagesByTopic, runningIds]
  );

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

  const onSend = useCallback(
    async (text: string) => {
      if (!selectedId) return;
      // optimistic user message
      setMessagesByTopic((m) => {
        const list = [...(m[selectedId] || [])];
        list.push({
          id: cryptoId(),
          role: "user",
          content: text,
          tools: [],
          createdAt: Date.now(),
        });
        return { ...m, [selectedId]: list };
      });
      setBusyByTopic((b) => ({ ...b, [selectedId]: true }));
      setErrorByTopic((er) => ({ ...er, [selectedId]: null }));
      try {
        await api.sendMessage(selectedId, text);
      } catch (e: any) {
        setErrorByTopic((er) => ({ ...er, [selectedId]: String(e) }));
        setBusyByTopic((b) => ({ ...b, [selectedId]: false }));
      }
    },
    [selectedId]
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
    <div className={`app`}>
      <LeftSidebar
        topics={topics}
        selectedId={selectedId}
        runningIds={runningIds}
        spawningId={spawningId}
        cliStatus={cliStatus}
        onSelect={onSelect}
        onNewTopic={() => setShowNew(true)}
        onDeleteTopic={onDelete}
        onRenameTopic={onRename}
      />

      {!selectedTopic ? (
        <>
          <section className="middle">
            <div className="empty">
              选择一个 Topic 开始对话，或者
              <button className="btn primary" style={{ marginLeft: 10 }} onClick={() => setShowNew(true)}>
                新建一个
              </button>
            </div>
          </section>
          <aside className="right">
            <div className="empty" style={{ padding: 30, fontSize: 12 }}>
              （未选中 Topic）
            </div>
          </aside>
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
              onApprovePermission={onApprove}
              onSelectTool={setSelectedTool}
            />
            <Composer
              busy={!!busyByTopic[selectedTopic.id]}
              onSend={onSend}
              onInterrupt={onInterrupt}
            />
          </section>
          <RightPane
            topic={selectedTopic}
            selectedTool={selectedTool}
            logs={logsByTopic[selectedTopic.id] || []}
            refreshKey={filesRefreshKey}
          />
        </>
      )}

      {showNew && (
        <NewTopicDialog
          cliStatus={cliStatus}
          onCancel={() => setShowNew(false)}
          onCreate={onCreateTopic}
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

function hydrate(msgs: Message[]): UiMessage[] {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    tools: [],
    createdAt: m.createdAt,
  }));
}
