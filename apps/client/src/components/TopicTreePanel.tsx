import { useEffect, useMemo, useRef, useState } from "react";
import { TopicSnapshot, useAppStore } from "../store/useAppStore";
import { useVirtualRows } from "../hooks/useVirtualRows";
import { TopicRow, TopicWorkerResponse } from "../types/topicRows";
import { activityDurations } from "../lib/topicActivity";
import { formatCompactCount, formatExactCount } from "../lib/formatCount";

interface Props {
  selectedTopic: string | null;
  topics: Map<string, TopicSnapshot>;
}

const ROW_HEIGHT = 26;
function formatBurstCount(value: number): string {
  return value > 99 ? "99+" : String(value);
}

export function TopicTreePanel({ selectedTopic, topics }: Props) {
  const searchTerm = useAppStore((state) => state.searchTerm);
  const setSearchTerm = useAppStore((state) => state.setSearchTerm);
  const expandedPaths = useAppStore((state) => state.expandedPaths);
  const toggleExpanded = useAppStore((state) => state.toggleExpanded);
  const setSelectedTopic = useAppStore((state) => state.setSelectedTopic);
  const topicRevision = useAppStore((state) => state.topicRevision);
  const topicStatsRevision = useAppStore((state) => state.topicStatsRevision);
  const activityMode = useAppStore((state) => state.topicActivityMode);
  const setActivityMode = useAppStore((state) => state.setTopicActivityMode);
  const [rows, setRows] = useState<TopicRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (activityMode === "off") {
      return;
    }
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, activityMode === "full" ? 250 : 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [activityMode]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/topicIndex.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<TopicWorkerResponse>) => {
      const payload = event.data;
      if (payload.type !== "visible-rows") {
        return;
      }
      if (payload.requestId !== requestIdRef.current) {
        return;
      }
      setRows(payload.rows);
      setTotalRows(payload.totalRows);
      setNowTick(Date.now());
    };

    const initialSnapshots = Array.from(useAppStore.getState().topics.values());
    const initialTopics = initialSnapshots.map((entry) => entry.topic);
    worker.postMessage({ type: "reset" });
    if (initialTopics.length > 0) {
      worker.postMessage({ type: "add-topics", topics: initialTopics });
      worker.postMessage({
        type: "update-topic-counts",
        activityMode: "off",
        updates: initialSnapshots.map((entry) => ({
          topic: entry.topic,
          deltaMessages: entry.messageCount
        }))
      });
    }

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) {
      return;
    }

    const pendingTopics = useAppStore.getState().drainPendingNewTopics();
    if (pendingTopics.length > 0) {
      worker.postMessage({ type: "add-topics", topics: pendingTopics });
    }
    const pendingTopicDeltas = useAppStore.getState().drainPendingTopicCountDeltas();
    if (pendingTopicDeltas.length > 0) {
      worker.postMessage({
        type: "update-topic-counts",
        activityMode,
        updates: pendingTopicDeltas
      });
    }

    requestIdRef.current += 1;
    worker.postMessage({
      type: "compute-visible",
      requestId: requestIdRef.current,
      expandedPaths: Array.from(expandedPaths),
      searchTerm
    });
  }, [activityMode, expandedPaths, searchTerm, topicRevision, topicStatsRevision]);

  const durations = useMemo(() => activityDurations(activityMode), [activityMode]);

  const { containerRef, visibleItems, topPadding, bottomPadding } = useVirtualRows(
    rows,
    ROW_HEIGHT
  );

  return (
    <section className="panel topic-tree">
      <header className="panel-header">
        <h2>Topic Explorer</h2>
        <div className="topic-tree-controls">
          <label className="activity-mode-control">
            <span>Activity</span>
            <select
              value={activityMode}
              onChange={(event) =>
                setActivityMode(event.target.value as typeof activityMode)
              }
              aria-label="Topic activity indication"
            >
              <option value="off">Off</option>
              <option value="subtle">Subtle</option>
              <option value="full">Full</option>
            </select>
          </label>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Filter topics"
          />
        </div>
      </header>
      <div className="topic-tree-list" ref={containerRef}>
        <div style={{ height: topPadding }} />
        {visibleItems.map(({ item }) => {
          const topic = topics.get(item.fullPath);
          const hasChildren = item.hasChildren;
          const isSelected = item.fullPath === selectedTopic;
          const directRecent =
            activityMode !== "off" &&
            nowTick - item.directActivityAt >= 0 &&
            nowTick - item.directActivityAt < durations.recentMs;
          const descendantRecent =
            activityMode !== "off" &&
            nowTick - item.descendantActivityAt >= 0 &&
            nowTick - item.descendantActivityAt < durations.recentMs;
          const collapsedDescendantActivity =
            hasChildren && !item.expanded && descendantRecent;
          const directPulse =
            directRecent && nowTick - item.directPulseAt < durations.pulseMs;
          const descendantPulse =
            descendantRecent && nowTick - item.descendantPulseAt < durations.pulseMs;
          const shouldPulse =
            directPulse ||
            (activityMode === "full" && descendantPulse) ||
            (collapsedDescendantActivity && descendantPulse);
          const burstCount =
            (directRecent ? item.directBurstCount : 0) +
            (descendantRecent ? item.descendantBurstCount : 0);

          return (
            <button
              key={item.key}
              className={`topic-row ${
                isSelected ? "selected" : ""
              } activity-${activityMode} ${directRecent ? "direct-update" : ""} ${
                descendantRecent ? "descendant-update" : ""
              } ${collapsedDescendantActivity ? "collapsed-activity" : ""} ${
                shouldPulse ? "pulse-update" : ""
              } ${
                hasChildren ? "branch-row" : "leaf-row"
              } ${item.isLeaf ? "endpoint-row" : ""}`}
              style={{ height: `${ROW_HEIGHT}px` }}
              onClick={() => {
                if (item.isLeaf) {
                  setSelectedTopic(item.fullPath);
                }
                if (hasChildren) {
                  toggleExpanded(item.fullPath);
                }
              }}
              type="button"
              title={item.fullPath}
            >
              <span
                className="depth-guides"
                style={{ width: `${item.depth * 12}px` }}
                aria-hidden
              />
              <span className="twisty">{hasChildren ? (item.expanded ? "▾" : "▸") : "•"}</span>
              <span className="topic-main">
                <span className="topic-name">{item.label}</span>
                {item.isLeaf && topic ? (
                  <span className="topic-preview">= {topic.preview}</span>
                ) : null}
                {hasChildren ? (
                  <span
                    className="branch-meta"
                    title={`${formatExactCount(item.topicCount)} descendant topics`}
                  >
                    {formatCompactCount(item.topicCount)} {item.topicCount === 1 ? "topic" : "topics"}
                  </span>
                ) : null}
              </span>
              {item.isLeaf && topic ? (
                <span
                  className="topic-msg-count"
                  title={`${formatExactCount(topic.messageCount)} messages received on this topic`}
                  aria-label={`${formatExactCount(topic.messageCount)} messages received on this topic`}
                >
                  {formatCompactCount(topic.messageCount)}
                </span>
              ) : null}
              {activityMode === "full" && burstCount > 0 ? (
                <span className="new-msg-chip">+{formatBurstCount(burstCount)}</span>
              ) : activityMode === "subtle" && (directRecent || descendantRecent) ? (
                <span
                  className={`activity-dot ${directRecent ? "direct" : "descendant"}`}
                  title={
                    directRecent
                      ? "Topic received a message"
                      : "A descendant topic received a message"
                  }
                  aria-hidden
                />
              ) : null}
              {topic?.retain ? <span className="retain-chip">R</span> : null}
            </button>
          );
        })}
        <div style={{ height: bottomPadding }} />
      </div>
      <footer className="panel-footer">
        <span>{totalRows.toLocaleString()} rows</span>
      </footer>
    </section>
  );
}
