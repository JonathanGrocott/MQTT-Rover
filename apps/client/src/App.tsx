import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageEnvelope,
  OverloadMode,
  PublishRequest,
  SubscriptionRequest
} from "@mqtt-rover/protocol";
import { ConnectionToolbar } from "./components/ConnectionToolbar";
import { TopicTreePanel } from "./components/TopicTreePanel";
import { PayloadPanel } from "./components/PayloadPanel";
import { PublishPanel } from "./components/PublishPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { TimelineEntry, TimelinePanel } from "./components/TimelinePanel";
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

interface ManagedSubscription extends SubscriptionRequest {
  source: "initial" | "runtime";
}

type ViewPreset = "simple" | "advanced";

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

function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const withMessage = error as { message?: unknown; payload?: unknown };
    if (typeof withMessage.message === "string" && withMessage.message.trim().length > 0) {
      return withMessage.message;
    }
    if (typeof withMessage.payload === "string" && withMessage.payload.trim().length > 0) {
      return withMessage.payload;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }
  return "Unknown error";
}

function queueLoad(
  coalescedSize: number,
  historySize: number,
  preset: OverloadPreset
): number {
  const coalescedRatio = coalescedSize / preset.maxCoalescedTopics;
  const historyRatio = historySize / preset.maxHistoryQueue;
  return Math.max(coalescedRatio, historyRatio);
}

function resolveInitialSubscriptions(profile: {
  subscriptionFilter?: string;
  initialSubscriptions?: SubscriptionRequest[];
}): SubscriptionRequest[] {
  const configured =
    profile.initialSubscriptions?.filter(
      (entry) => entry.topicFilter.trim().length > 0
    ) ?? [];

  if (configured.length > 0) {
    return configured;
  }

  return [{ topicFilter: profile.subscriptionFilter?.trim() || "#", qos: 0 }];
}

function readBooleanPreference(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (raw === "1") {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  return fallback;
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
  const connectionState = useAppStore((state) => state.connectionState);
  const setConnectionState = useAppStore((state) => state.setConnectionState);
  const clearRuntimeData = useAppStore((state) => state.clearRuntimeData);
  const toggleHistoryForTopic = useAppStore((state) => state.toggleHistoryForTopic);
  const coalescedMessagesRef = useRef<Map<string, MessageEnvelope>>(new Map());
  const historyMessagesRef = useRef<MessageEnvelope[]>([]);
  const flushHandleRef = useRef<number | null>(null);
  const flushModeRef = useRef<"none" | "raf" | "timeout">("none");
  const timelineQueueRef = useRef<TimelineEntry[]>([]);
  const timelineNextIdRef = useRef(1);
  const timelinePausedRef = useRef(false);
  const timelineReplayTimerRef = useRef<number | null>(null);
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
  const [subscriptions, setSubscriptions] = useState<ManagedSubscription[]>([]);
  const [timelinePaused, setTimelinePaused] = useState(false);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [rightPanelView, setRightPanelView] = useState<"history" | "timeline">(
    "history"
  );
  const [viewPreset, setViewPreset] = useState<ViewPreset>(() => {
    if (typeof window === "undefined") {
      return "simple";
    }
    const saved = window.localStorage.getItem("mqtt-rover.view-preset");
    return saved === "advanced" ? "advanced" : "simple";
  });
  const [connectionsCollapsed, setConnectionsCollapsed] = useState(() =>
    readBooleanPreference("mqtt-rover.panel.connections-collapsed", true)
  );
  const [publishCollapsed, setPublishCollapsed] = useState(() =>
    readBooleanPreference("mqtt-rover.panel.publish-collapsed", true)
  );
  const [historyCollapsed, setHistoryCollapsed] = useState(() =>
    readBooleanPreference("mqtt-rover.panel.history-collapsed", true)
  );
  const [focusPanel, setFocusPanel] = useState<"none" | "publish" | "history">(
    "none"
  );
  const [payloadSplit, setPayloadSplit] = useState(0.66);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1600
  );
  const [leftColumnRatio, setLeftColumnRatio] = useState(0.4);
  const [middleColumnRatio, setMiddleColumnRatio] = useState(0.42);
  const [draggingColumn, setDraggingColumn] = useState<"none" | "left" | "right">(
    "none"
  );
  const middleColumnRef = useRef<HTMLDivElement | null>(null);
  const mainGridRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("mqtt-rover.view-preset", viewPreset);
    if (viewPreset === "simple") {
      setConnectionsCollapsed(true);
      setFocusPanel("none");
    }
  }, [viewPreset]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "mqtt-rover.panel.connections-collapsed",
      connectionsCollapsed ? "1" : "0"
    );
  }, [connectionsCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "mqtt-rover.panel.publish-collapsed",
      publishCollapsed ? "1" : "0"
    );
  }, [publishCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "mqtt-rover.panel.history-collapsed",
      historyCollapsed ? "1" : "0"
    );
  }, [historyCollapsed]);

  useEffect(() => {
    if (publishCollapsed && focusPanel === "publish") {
      setFocusPanel("none");
    }
  }, [publishCollapsed, focusPanel]);

  useEffect(() => {
    if (historyCollapsed && focusPanel === "history") {
      setFocusPanel("none");
    }
  }, [historyCollapsed, focusPanel]);

  useEffect(() => {
    timelinePausedRef.current = timelinePaused;
  }, [timelinePaused]);

  useEffect(() => {
    if (!draggingSplit) {
      return;
    }

    const onMove = (event: MouseEvent) => {
      const node = middleColumnRef.current;
      if (!node) {
        return;
      }
      const bounds = node.getBoundingClientRect();
      if (bounds.height <= 0) {
        return;
      }
      const raw = (event.clientY - bounds.top) / bounds.height;
      const clamped = Math.min(0.84, Math.max(0.38, raw));
      setPayloadSplit(clamped);
    };

    const onUp = () => {
      setDraggingSplit(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingSplit]);

  useEffect(() => {
    if (draggingColumn === "none") {
      return;
    }

    const leftMin = 0.2;
    const middleMin = 0.22;
    const rightMin = 0.18;

    const onMove = (event: MouseEvent) => {
      const node = mainGridRef.current;
      if (!node) {
        return;
      }
      const bounds = node.getBoundingClientRect();
      if (bounds.width <= 0) {
        return;
      }
      const xRatio = (event.clientX - bounds.left) / bounds.width;

      if (draggingColumn === "left") {
        let nextLeft = Math.max(leftMin, Math.min(0.7, xRatio));
        const maxLeft = historyCollapsed
          ? 1 - middleMin
          : 1 - middleColumnRatio - rightMin;
        nextLeft = Math.min(nextLeft, maxLeft);
        setLeftColumnRatio(nextLeft);
      } else if (draggingColumn === "right") {
        if (historyCollapsed) {
          return;
        }
        let nextMiddle = xRatio - leftColumnRatio;
        const maxMiddle = 1 - leftColumnRatio - rightMin;
        nextMiddle = Math.max(middleMin, Math.min(maxMiddle, nextMiddle));
        setMiddleColumnRatio(nextMiddle);
      }
    };

    const onUp = () => {
      setDraggingColumn("none");
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingColumn, historyCollapsed, leftColumnRatio, middleColumnRatio]);

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

  const resetTimeline = () => {
    if (timelineReplayTimerRef.current !== null) {
      window.clearTimeout(timelineReplayTimerRef.current);
      timelineReplayTimerRef.current = null;
    }
    timelineQueueRef.current = [];
    timelineNextIdRef.current = 1;
    timelinePausedRef.current = false;
    setTimelineEntries([]);
    setTimelinePaused(false);
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (timelinePausedRef.current) {
        return;
      }
      const pending = timelineQueueRef.current;
      if (pending.length === 0) {
        return;
      }
      timelineQueueRef.current = [];
      setTimelineEntries((current) => {
        const next = [...current, ...pending];
        if (next.length <= 4000) {
          return next;
        }
        return next.slice(next.length - 4000);
      });
    }, 220);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timelineReplayTimerRef.current !== null) {
        window.clearTimeout(timelineReplayTimerRef.current);
        timelineReplayTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (connectionState !== "connected") {
      setSubscriptions([]);
    }
  }, [connectionState]);

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
    resetTimeline();
    publishRuntimeStats();

    clearRuntimeData();
    setConnectionState("connecting");

    try {
      const initialSubscriptions = resolveInitialSubscriptions(profile);
      const connectProfile = {
        ...profile,
        subscriptionFilter: profile.subscriptionFilter?.trim() || "#",
        initialSubscriptions
      };
      await mqttRuntime.connect(connectProfile, {
        onMessage: (message) => {
          if (!timelinePausedRef.current) {
            timelineQueueRef.current.push({
              id: timelineNextIdRef.current++,
              message
            });
          }
          enqueueMessage(message);
        },
        onState: (state) => {
          setConnectionState(state);
          if (state === "connected") {
            setSubscriptions(
              connectProfile.initialSubscriptions.map((entry) => ({
                ...entry,
                source: "initial"
              }))
            );
          } else if (state === "disconnected") {
            setSubscriptions([]);
          }
        },
        onError: (message) => {
          setConnectionState("error", message);
        }
      });
    } catch (error) {
      const message = errorMessage(error);
      setConnectionState("error", message);
    }
  };

  const disconnect = async () => {
    await mqttRuntime.disconnect();
    resetRuntimeBuffers();
    resetTimeline();
    publishRuntimeStats();
    setConnectionState("disconnected");
    setSubscriptions([]);
  };

  const publish = async (request: PublishRequest) => {
    await mqttRuntime.publish(request);
  };

  const subscribe = async (request: SubscriptionRequest) => {
    await mqttRuntime.subscribe(request);
    setSubscriptions((current) => {
      const existingIndex = current.findIndex(
        (entry) => entry.topicFilter === request.topicFilter
      );
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = { ...request, source: "runtime" };
        return next;
      }
      return [...current, { ...request, source: "runtime" }];
    });
  };

  const unsubscribe = async (topicFilter: string) => {
    await mqttRuntime.unsubscribe(topicFilter);
    setSubscriptions((current) =>
      current.filter((entry) => entry.topicFilter !== topicFilter)
    );
  };

  const importTimelineSession = (
    imported: MessageEnvelope[],
    mode: "append" | "replace" | "replay"
  ) => {
    if (imported.length === 0) {
      return;
    }

    const appendMessages = (messages: MessageEnvelope[]) => {
      setTimelineEntries((current) => {
        const mapped = messages.map((message) => ({
          id: timelineNextIdRef.current++,
          message
        }));
        const next = [...current, ...mapped];
        if (next.length <= 4000) {
          return next;
        }
        return next.slice(next.length - 4000);
      });
    };

    if (mode === "append") {
      appendMessages(imported);
      return;
    }

    if (mode === "replace") {
      if (timelineReplayTimerRef.current !== null) {
        window.clearTimeout(timelineReplayTimerRef.current);
        timelineReplayTimerRef.current = null;
      }
      timelineQueueRef.current = [];
      timelineNextIdRef.current = 1;
      setTimelineEntries(
        imported.slice(-4000).map((message) => ({
          id: timelineNextIdRef.current++,
          message
        }))
      );
      return;
    }

    const replayList = [...imported].sort((left, right) => left.timestamp - right.timestamp);
    if (timelineReplayTimerRef.current !== null) {
      window.clearTimeout(timelineReplayTimerRef.current);
      timelineReplayTimerRef.current = null;
    }
    timelineQueueRef.current = [];
    timelineNextIdRef.current = 1;
    setTimelineEntries([]);

    const pausedBeforeReplay = timelinePausedRef.current;
    setTimelinePaused(true);

    let index = 0;
    const pushNext = () => {
      if (index >= replayList.length) {
        timelineReplayTimerRef.current = null;
        setTimelinePaused(pausedBeforeReplay);
        return;
      }

      const current = replayList[index];
      if (current) {
        appendMessages([current]);
      }
      index += 1;

      if (index >= replayList.length) {
        timelineReplayTimerRef.current = null;
        setTimelinePaused(pausedBeforeReplay);
        return;
      }

      const next = replayList[index];
      const delay = next
        ? Math.max(20, Math.min(280, next.timestamp - (current?.timestamp ?? next.timestamp)))
        : 40;
      timelineReplayTimerRef.current = window.setTimeout(pushNext, delay);
    };

    pushNext();
  };

  const middleColumnRows =
    focusPanel === "publish"
      ? "1fr"
      : publishCollapsed
        ? "1fr"
        : `${payloadSplit}fr 10px ${1 - payloadSplit}fr`;

  const showLeftResizer = focusPanel === "none" && viewportWidth > 1400;
  const showRightResizer = showLeftResizer && !historyCollapsed;
  const rightColumnRatio = Math.max(0.18, 1 - leftColumnRatio - middleColumnRatio);
  const mainGridTemplate = showLeftResizer
    ? historyCollapsed
      ? `${leftColumnRatio}fr 10px ${1 - leftColumnRatio}fr`
      : `${leftColumnRatio}fr 10px ${middleColumnRatio}fr 10px ${rightColumnRatio}fr`
    : undefined;

  return (
    <main
      className={`app-shell ${draggingSplit ? "resizing-y" : ""} ${
        draggingColumn !== "none" ? "resizing-x" : ""
      }`}
    >
      <div className="workspace-strip">
        <button
          type="button"
          className={connectionsCollapsed ? "button-ghost" : "button-primary"}
          onClick={() => setConnectionsCollapsed((current) => !current)}
        >
          {connectionsCollapsed ? "Show Connections" : "Hide Connections"}
        </button>
        <button
          type="button"
          className={publishCollapsed ? "button-ghost" : "button-primary"}
          onClick={() => setPublishCollapsed((current) => !current)}
        >
          {publishCollapsed ? "Show Publish" : "Hide Publish"}
        </button>
        <button
          type="button"
          className={historyCollapsed ? "button-ghost" : "button-primary"}
          onClick={() => setHistoryCollapsed((current) => !current)}
        >
          {historyCollapsed ? "Show History/Timeline" : "Hide History/Timeline"}
        </button>
        <span className="workspace-strip-note">
          Prioritize Topic Explorer + Payload Viewer
        </span>
      </div>

      {!connectionsCollapsed ? (
        <ConnectionToolbar
          profile={profile}
          viewPreset={viewPreset}
          onChangeViewPreset={setViewPreset}
          collapsed={false}
          onToggleCollapsed={() => setConnectionsCollapsed(true)}
          runtimeStats={runtimeStats}
          onConnect={connect}
          onDisconnect={disconnect}
          subscriptions={subscriptions}
          subscriptionsDisabled={connectionState !== "connected"}
          onSubscribe={subscribe}
          onUnsubscribe={unsubscribe}
        />
      ) : null}

      <section
        ref={mainGridRef}
        className={`main-grid ${
          focusPanel !== "none" ? `focus-${focusPanel}` : ""
        } ${publishCollapsed ? "publish-collapsed" : ""} ${
          historyCollapsed ? "history-collapsed" : ""
        }`}
        style={mainGridTemplate ? { gridTemplateColumns: mainGridTemplate } : undefined}
      >
        <TopicTreePanel selectedTopic={selectedTopic} topics={topics} />

        {showLeftResizer ? (
          <div
            className="panel-resize-handle vertical"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize topic explorer and payload columns"
            onMouseDown={(event) => {
              event.preventDefault();
              setDraggingColumn("left");
            }}
          >
            <span />
          </div>
        ) : null}

        <div
          className="column stack middle-column"
          ref={middleColumnRef}
          style={{ gridTemplateRows: middleColumnRows }}
        >
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

          {focusPanel === "none" && !publishCollapsed ? (
            <div
              className="panel-resize-handle horizontal"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize payload and publish panels"
              onMouseDown={(event) => {
                event.preventDefault();
                setDraggingSplit(true);
              }}
            >
              <span />
            </div>
          ) : null}

          {!publishCollapsed ? (
            <PublishPanel
              selectedTopic={selectedTopic}
              mqtt5Enabled={(profile?.mqttProtocolVersion ?? 4) === 5}
              advancedMode={viewPreset === "advanced"}
              collapsed={false}
              focused={focusPanel === "publish"}
              onToggleCollapsed={() => {
                setPublishCollapsed(true);
                setFocusPanel("none");
              }}
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
          ) : null}
        </div>

        {showRightResizer ? (
          <div
            className="panel-resize-handle vertical"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize payload and history columns"
            onMouseDown={(event) => {
              event.preventDefault();
              setDraggingColumn("right");
            }}
          >
            <span />
          </div>
        ) : null}

        {!historyCollapsed
          ? rightPanelView === "history"
            ? (
              <HistoryPanel
                topic={selectedTopic}
                data={selectedHistory}
                collapsed={false}
                focused={focusPanel === "history"}
                onToggleCollapsed={() => {
                  setHistoryCollapsed(true);
                  setFocusPanel("none");
                }}
                onToggleFocused={() => {
                  setHistoryCollapsed(false);
                  setFocusPanel((current) =>
                    current === "history" ? "none" : "history"
                  );
                }}
                onShowTimeline={() => setRightPanelView("timeline")}
              />
            )
            : (
              <TimelinePanel
                messages={timelineEntries}
                advancedMode={viewPreset === "advanced"}
                collapsed={false}
                focused={focusPanel === "history"}
                paused={timelinePaused}
                onToggleCollapsed={() => {
                  setHistoryCollapsed(true);
                  setFocusPanel("none");
                }}
                onToggleFocused={() => {
                  setHistoryCollapsed(false);
                  setFocusPanel((current) =>
                    current === "history" ? "none" : "history"
                  );
                }}
                onTogglePaused={() => {
                  setTimelinePaused((current) => !current);
                }}
                onClear={() => {
                  if (timelineReplayTimerRef.current !== null) {
                    window.clearTimeout(timelineReplayTimerRef.current);
                    timelineReplayTimerRef.current = null;
                  }
                  timelineQueueRef.current = [];
                  setTimelineEntries([]);
                }}
                onImportSession={importTimelineSession}
                onShowHistory={() => setRightPanelView("history")}
              />
            )
          : null}
      </section>
    </main>
  );
}
