import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageEnvelope,
  OverloadMode,
  PublishRequest
} from "@mqtt-rover/protocol";
import { ConnectionToolbar } from "./components/ConnectionToolbar";
import { TopicTreePanel } from "./components/TopicTreePanel";
import { PayloadPanel } from "./components/PayloadPanel";
import { PublishPanel } from "./components/PublishPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { mqttRuntime } from "./lib/mqttRuntime";
import { useActiveProfile, useAppStore } from "./store/useAppStore";

interface RuntimeStats {
  msgPerSec: number;
  queued: number;
  coalescedTopics: number;
  historyBuffered: number;
  overloadMode: OverloadMode;
  droppedCoalesced: number;
  droppedHistory: number;
  lastBatchSize: number;
  lastFlushMs: number;
}

interface OverloadPreset {
  maxCoalescedTopics: number;
  maxHistoryQueue: number;
  fastFlushLoad: number;
  fastFlushMsgPerSec: number;
  dropNonHistory: "evict-oldest" | "drop-incoming";
  dropHistory: "drop-oldest" | "drop-incoming";
}

const OVERLOAD_PRESETS: Record<OverloadMode, OverloadPreset> = {
  balanced: {
    maxCoalescedTopics: 25_000,
    maxHistoryQueue: 20_000,
    fastFlushLoad: 0.55,
    fastFlushMsgPerSec: 1_800,
    dropNonHistory: "evict-oldest",
    dropHistory: "drop-oldest"
  },
  "history-priority": {
    maxCoalescedTopics: 10_000,
    maxHistoryQueue: 50_000,
    fastFlushLoad: 0.45,
    fastFlushMsgPerSec: 1_200,
    dropNonHistory: "drop-incoming",
    dropHistory: "drop-oldest"
  },
  "latest-only": {
    maxCoalescedTopics: 8_000,
    maxHistoryQueue: 5_000,
    fastFlushLoad: 0.4,
    fastFlushMsgPerSec: 1_000,
    dropNonHistory: "evict-oldest",
    dropHistory: "drop-incoming"
  }
};

function queueLoad(
  coalescedSize: number,
  historySize: number,
  preset: OverloadPreset
): number {
  const coalescedRatio = coalescedSize / preset.maxCoalescedTopics;
  const historyRatio = historySize / preset.maxHistoryQueue;
  return Math.max(coalescedRatio, historyRatio);
}

export default function App() {
  const profile = useActiveProfile();
  const overloadMode: OverloadMode = profile?.overloadMode ?? "balanced";
  const overloadPreset = OVERLOAD_PRESETS[overloadMode];
  const selectedTopic = useAppStore((state) => state.selectedTopic);
  const topics = useAppStore((state) => state.topics);
  const historyEnabledTopics = useAppStore((state) => state.historyEnabledTopics);
  const historyByTopic = useAppStore((state) => state.historyByTopic);
  const ingestMessages = useAppStore((state) => state.ingestMessages);
  const setConnectionState = useAppStore((state) => state.setConnectionState);
  const clearRuntimeData = useAppStore((state) => state.clearRuntimeData);
  const toggleHistoryForTopic = useAppStore((state) => state.toggleHistoryForTopic);
  const coalescedMessagesRef = useRef<Map<string, MessageEnvelope>>(new Map());
  const historyMessagesRef = useRef<MessageEnvelope[]>([]);
  const flushHandleRef = useRef<number | null>(null);
  const flushModeRef = useRef<"none" | "raf" | "timeout">("none");
  const droppedCoalescedRef = useRef(0);
  const droppedHistoryRef = useRef(0);
  const lastBatchSizeRef = useRef(0);
  const lastFlushMsRef = useRef(0);
  const incomingCounterRef = useRef(0);
  const incomingRateRef = useRef(0);
  const lastRateTimestampRef = useRef(performance.now());
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStats>({
    msgPerSec: 0,
    queued: 0,
    coalescedTopics: 0,
    historyBuffered: 0,
    overloadMode: "balanced",
    droppedCoalesced: 0,
    droppedHistory: 0,
    lastBatchSize: 0,
    lastFlushMs: 0
  });
  const [connectionsCollapsed, setConnectionsCollapsed] = useState(false);
  const [publishCollapsed, setPublishCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [focusPanel, setFocusPanel] = useState<"none" | "publish" | "history">(
    "none"
  );

  useEffect(() => {
    if (window.innerHeight < 900) {
      setConnectionsCollapsed(true);
      setPublishCollapsed(true);
    }
  }, []);

  const cancelScheduledFlush = () => {
    if (flushHandleRef.current === null) {
      return;
    }

    if (flushModeRef.current === "raf") {
      window.cancelAnimationFrame(flushHandleRef.current);
    } else if (flushModeRef.current === "timeout") {
      window.clearTimeout(flushHandleRef.current);
    }

    flushHandleRef.current = null;
    flushModeRef.current = "none";
  };

  const publishRuntimeStats = () => {
    setRuntimeStats({
      msgPerSec: incomingRateRef.current,
      queued:
        coalescedMessagesRef.current.size + historyMessagesRef.current.length,
      coalescedTopics: coalescedMessagesRef.current.size,
      historyBuffered: historyMessagesRef.current.length,
      overloadMode,
      droppedCoalesced: droppedCoalescedRef.current,
      droppedHistory: droppedHistoryRef.current,
      lastBatchSize: lastBatchSizeRef.current,
      lastFlushMs: lastFlushMsRef.current
    });
  };

  const flushQueuedMessages = () => {
    flushHandleRef.current = null;
    flushModeRef.current = "none";

    const coalesced = Array.from(coalescedMessagesRef.current.values());
    const history = historyMessagesRef.current;
    if (coalesced.length === 0 && history.length === 0) {
      return;
    }

    coalescedMessagesRef.current.clear();
    historyMessagesRef.current = [];
    const batch = [...coalesced, ...history];
    const startedAt = performance.now();
    ingestMessages(batch);
    lastBatchSizeRef.current = batch.length;
    lastFlushMsRef.current = performance.now() - startedAt;
  };

  const scheduleFlush = () => {
    if (flushHandleRef.current !== null) {
      return;
    }

    const load = queueLoad(
      coalescedMessagesRef.current.size,
      historyMessagesRef.current.length,
      overloadPreset
    );

    const shouldFastFlush =
      load >= overloadPreset.fastFlushLoad ||
      incomingRateRef.current >= overloadPreset.fastFlushMsgPerSec;

    if (shouldFastFlush) {
      flushModeRef.current = "timeout";
      flushHandleRef.current = window.setTimeout(flushQueuedMessages, 0);
      return;
    }

    flushModeRef.current = "raf";
    flushHandleRef.current = window.requestAnimationFrame(() => {
      flushQueuedMessages();
    });
  };

  const enqueueMessage = (message: MessageEnvelope) => {
    incomingCounterRef.current += 1;

    if (useAppStore.getState().historyEnabledTopics.has(message.topic)) {
      if (historyMessagesRef.current.length >= overloadPreset.maxHistoryQueue) {
        if (overloadPreset.dropHistory === "drop-incoming") {
          droppedHistoryRef.current += 1;
          scheduleFlush();
          return;
        }

        const dropCount =
          historyMessagesRef.current.length - overloadPreset.maxHistoryQueue + 1;
        historyMessagesRef.current.splice(0, dropCount);
        droppedHistoryRef.current += dropCount;
      }

      historyMessagesRef.current.push(message);
      scheduleFlush();
      return;
    }

    const existing = coalescedMessagesRef.current.has(message.topic);
    if (existing) {
      coalescedMessagesRef.current.set(message.topic, message);
      scheduleFlush();
      return;
    }

    if (coalescedMessagesRef.current.size >= overloadPreset.maxCoalescedTopics) {
      if (overloadPreset.dropNonHistory === "drop-incoming") {
        droppedCoalescedRef.current += 1;
        scheduleFlush();
        return;
      }

      const oldest = coalescedMessagesRef.current.keys().next().value;
      if (oldest) {
        coalescedMessagesRef.current.delete(oldest);
        droppedCoalescedRef.current += 1;
      }
    }

    coalescedMessagesRef.current.set(message.topic, message);
    scheduleFlush();
  };

  const resetRuntimeBuffers = () => {
    coalescedMessagesRef.current.clear();
    historyMessagesRef.current = [];
    droppedCoalescedRef.current = 0;
    droppedHistoryRef.current = 0;
    lastBatchSizeRef.current = 0;
    lastFlushMsRef.current = 0;
    incomingCounterRef.current = 0;
    incomingRateRef.current = 0;
    lastRateTimestampRef.current = performance.now();
    cancelScheduledFlush();
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedSec = (now - lastRateTimestampRef.current) / 1000;
      if (elapsedSec >= 1) {
        incomingRateRef.current = incomingCounterRef.current / elapsedSec;
        incomingCounterRef.current = 0;
        lastRateTimestampRef.current = now;
      }
      publishRuntimeStats();
    }, 500);

    return () => {
      window.clearInterval(timer);
      cancelScheduledFlush();
    };
  }, [overloadMode]);

  useEffect(() => {
    publishRuntimeStats();
  }, [overloadMode]);

  const selectedSnapshot = selectedTopic ? topics.get(selectedTopic) : undefined;
  const selectedHistory = selectedTopic
    ? historyByTopic.get(selectedTopic) ?? []
    : [];

  const selectedHistoryEnabled = useMemo(() => {
    if (!selectedTopic) {
      return false;
    }
    return historyEnabledTopics.has(selectedTopic);
  }, [historyEnabledTopics, selectedTopic]);

  const connect = async () => {
    if (!profile) {
      return;
    }

    resetRuntimeBuffers();
    publishRuntimeStats();

    clearRuntimeData();
    setConnectionState("connecting");

    try {
      const connectProfile = {
        ...profile,
        subscriptionFilter: profile.subscriptionFilter?.trim() || "#"
      };
      await mqttRuntime.connect(connectProfile, {
        onMessage: (message) => {
          enqueueMessage(message);
        },
        onState: (state) => {
          setConnectionState(state);
        },
        onError: (message) => {
          setConnectionState("error", message);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setConnectionState("error", message);
    }
  };

  const disconnect = async () => {
    await mqttRuntime.disconnect();
    resetRuntimeBuffers();
    publishRuntimeStats();
    setConnectionState("disconnected");
  };

  const publish = async (request: PublishRequest) => {
    await mqttRuntime.publish(request);
  };

  return (
    <main className="app-shell">
      <ConnectionToolbar
        profile={profile}
        collapsed={connectionsCollapsed}
        onToggleCollapsed={() =>
          setConnectionsCollapsed((current) => !current)
        }
        runtimeStats={runtimeStats}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      <section
        className={`main-grid ${
          focusPanel !== "none" ? `focus-${focusPanel}` : ""
        } ${publishCollapsed ? "publish-collapsed" : ""} ${
          historyCollapsed ? "history-collapsed" : ""
        }`}
      >
        <TopicTreePanel selectedTopic={selectedTopic} topics={topics} />

        <div className="column stack middle-column">
          <PayloadPanel
            topic={selectedTopic}
            snapshot={selectedSnapshot}
            historyEnabled={selectedHistoryEnabled}
            onToggleHistory={() => {
              if (selectedTopic) {
                toggleHistoryForTopic(selectedTopic);
              }
            }}
            onPublishRetained={async (topic, payload) => {
              await publish({ topic, payload, qos: 1, retain: true });
            }}
          />

          <PublishPanel
            selectedTopic={selectedTopic}
            collapsed={publishCollapsed}
            focused={focusPanel === "publish"}
            onToggleCollapsed={() =>
              setPublishCollapsed((current) => !current)
            }
            onToggleFocused={() => {
              setPublishCollapsed(false);
              setFocusPanel((current) =>
                current === "publish" ? "none" : "publish"
              );
            }}
            onPublish={async (request) => {
              await publish(request);
            }}
          />
        </div>

        <HistoryPanel
          topic={selectedTopic}
          data={selectedHistory}
          collapsed={historyCollapsed}
          focused={focusPanel === "history"}
          onToggleCollapsed={() =>
            setHistoryCollapsed((current) => !current)
          }
          onToggleFocused={() => {
            setHistoryCollapsed(false);
            setFocusPanel((current) =>
              current === "history" ? "none" : "history"
            );
          }}
        />
      </section>
    </main>
  );
}
