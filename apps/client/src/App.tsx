import { useMemo } from "react";
import { OverloadMode } from "@mqtt-rover/protocol";
import { ConnectionToolbar } from "./components/ConnectionToolbar";
import { TopicTreePanel } from "./components/TopicTreePanel";
import { PayloadPanel } from "./components/PayloadPanel";
import { PublishPanel } from "./components/PublishPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { TimelinePanel } from "./components/TimelinePanel";
import { useConnectionSessionRuntime } from "./hooks/useConnectionSessionRuntime";
import { useMessageIngestionRuntime, OverloadPreset } from "./hooks/useMessageIngestionRuntime";
import { useTimelineRuntime } from "./hooks/useTimelineRuntime";
import { useWorkspaceLayout } from "./hooks/useWorkspaceLayout";
import { useActiveProfile, useAppStore } from "./store/useAppStore";

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

export default function App() {
  const profile = useActiveProfile();
  const overloadMode: OverloadMode = profile?.overloadMode ?? "balanced";
  const overloadPreset = OVERLOAD_PRESETS[overloadMode];
  const selectedTopic = useAppStore((state) => state.selectedTopic);
  const topics = useAppStore((state) => state.topics);
  const historyEnabledTopics = useAppStore((state) => state.historyEnabledTopics);
  const historyByTopic = useAppStore((state) => state.historyByTopic);
  const messageHistoryByTopic = useAppStore(
    (state) => state.messageHistoryByTopic
  );
  const ingestMessages = useAppStore((state) => state.ingestMessages);
  const connectionState = useAppStore((state) => state.connectionState);
  const setConnectionState = useAppStore((state) => state.setConnectionState);
  const clearRuntimeData = useAppStore((state) => state.clearRuntimeData);
  const toggleHistoryForTopic = useAppStore((state) => state.toggleHistoryForTopic);

  const {
    runtimeStats,
    enqueueMessage,
    resetRuntimeBuffers,
    syncRuntimeStats
  } = useMessageIngestionRuntime({
    overloadMode,
    overloadPreset,
    ingestMessages
  });

  const {
    timelinePaused,
    setTimelinePaused,
    timelineEntries,
    rightPanelView,
    setRightPanelView,
    queueLiveMessage,
    clearTimeline,
    resetTimeline,
    importTimelineSession
  } = useTimelineRuntime();

  const {
    subscriptions,
    connect,
    disconnect,
    publish,
    subscribe,
    unsubscribe
  } = useConnectionSessionRuntime({
    profile,
    connectionState,
    setConnectionState,
    clearRuntimeData,
    resetRuntimeBuffers,
    resetTimeline,
    syncRuntimeStats,
    queueLiveMessage,
    enqueueMessage
  });

  const {
    viewPreset,
    setViewPreset,
    connectionsCollapsed,
    setConnectionsCollapsed,
    publishCollapsed,
    setPublishCollapsed,
    historyCollapsed,
    setHistoryCollapsed,
    focusPanel,
    setFocusPanel,
    setDraggingSplit,
    draggingSplit,
    setDraggingColumn,
    draggingColumn,
    middleColumnRef,
    mainGridRef,
    middleColumnRows,
    showLeftResizer,
    showRightResizer,
    mainGridTemplate
  } = useWorkspaceLayout();

  const selectedSnapshot = selectedTopic ? topics.get(selectedTopic) : undefined;
  const selectedHistory = selectedTopic
    ? historyByTopic.get(selectedTopic) ?? []
    : [];
  const selectedMessageHistory = selectedTopic
    ? messageHistoryByTopic.get(selectedTopic) ?? []
    : [];

  const selectedHistoryEnabled = useMemo(() => {
    if (!selectedTopic) {
      return false;
    }
    return historyEnabledTopics.has(selectedTopic);
  }, [historyEnabledTopics, selectedTopic]);

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
            messageHistory={selectedMessageHistory}
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
                onClear={clearTimeline}
                onImportSession={importTimelineSession}
                onShowHistory={() => setRightPanelView("history")}
              />
            )
          : null}
      </section>
    </main>
  );
}
