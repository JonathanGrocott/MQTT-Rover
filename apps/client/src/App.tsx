import { useMemo, useState } from "react";
import { OverloadMode } from "@mqtt-rover/protocol";
import { ConnectionToolbar } from "./components/ConnectionToolbar";
import { TopicTreePanel } from "./components/TopicTreePanel";
import { PayloadPanel } from "./components/PayloadPanel";
import { PublishPanel } from "./components/PublishPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { HistoryOverlayPanel } from "./components/HistoryOverlayPanel";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { useConnectionSessionRuntime } from "./hooks/useConnectionSessionRuntime";
import { useMessageIngestionRuntime, OverloadPreset } from "./hooks/useMessageIngestionRuntime";
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

  const [rightPanelView, setRightPanelView] = useState<"history" | "overlay">(
    "history"
  );

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
    syncRuntimeStats,
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
  const enabledHistoryTopics = useMemo(
    () => Array.from(historyEnabledTopics).sort(),
    [historyEnabledTopics]
  );

  return (
    <main
      className={`app-shell ${connectionsCollapsed ? "connections-collapsed" : ""} ${draggingSplit ? "resizing-y" : ""} ${
        draggingColumn !== "none" ? "resizing-x" : ""
      }`}
    >
      <WorkspaceHeader
        profileName={profile?.name ?? "No profile"}
        connectionState={connectionState}
        runtimeStats={runtimeStats}
        connectionsOpen={!connectionsCollapsed}
        publishOpen={!publishCollapsed}
        historyOpen={!historyCollapsed}
        onToggleConnections={() => setConnectionsCollapsed((current) => !current)}
        onTogglePublish={() => setPublishCollapsed((current) => !current)}
        onToggleHistory={() => {
          if (historyCollapsed) {
            setRightPanelView("history");
            setHistoryCollapsed(false);
            setFocusPanel("none");
            return;
          }
          setHistoryCollapsed(true);
          setFocusPanel("none");
        }}
        onConnect={connect}
        onDisconnect={disconnect}
      />

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
            onShowHistoryChart={() => {
              setRightPanelView("history");
              setHistoryCollapsed(false);
              setFocusPanel("none");
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
                historyEnabled={selectedHistoryEnabled}
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
                onShowTimeline={() => setRightPanelView("overlay")}
              />
            )
            : (
              <HistoryOverlayPanel
                enabledTopics={enabledHistoryTopics}
                historyByTopic={historyByTopic}
                selectedTopic={selectedTopic}
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
                onShowHistory={() => setRightPanelView("history")}
              />
            )
          : null}
      </section>
    </main>
  );
}
