import { useEffect, useRef, useState } from "react";
import { TopicSnapshot, useAppStore } from "../store/useAppStore";
import { useVirtualRows } from "../hooks/useVirtualRows";
import { TopicRow, TopicWorkerResponse } from "../types/topicRows";

interface Props {
  selectedTopic: string | null;
  topics: Map<string, TopicSnapshot>;
}

const ROW_HEIGHT = 26;
const RECENT_MS = 1400;

export function TopicTreePanel({ selectedTopic, topics }: Props) {
  const searchTerm = useAppStore((state) => state.searchTerm);
  const setSearchTerm = useAppStore((state) => state.setSearchTerm);
  const expandedPaths = useAppStore((state) => state.expandedPaths);
  const toggleExpanded = useAppStore((state) => state.toggleExpanded);
  const setSelectedTopic = useAppStore((state) => state.setSelectedTopic);
  const topicRevision = useAppStore((state) => state.topicRevision);
  const topicStatsRevision = useAppStore((state) => state.topicStatsRevision);
  const [rows, setRows] = useState<TopicRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

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
    };

    const initialSnapshots = Array.from(useAppStore.getState().topics.values());
    const initialTopics = initialSnapshots.map((entry) => entry.topic);
    worker.postMessage({ type: "reset" });
    if (initialTopics.length > 0) {
      worker.postMessage({ type: "add-topics", topics: initialTopics });
      worker.postMessage({
        type: "update-topic-counts",
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
      worker.postMessage({ type: "update-topic-counts", updates: pendingTopicDeltas });
    }

    requestIdRef.current += 1;
    worker.postMessage({
      type: "compute-visible",
      requestId: requestIdRef.current,
      expandedPaths: Array.from(expandedPaths),
      searchTerm
    });
  }, [expandedPaths, searchTerm, topicRevision, topicStatsRevision]);

  const { containerRef, visibleItems, topPadding, bottomPadding } = useVirtualRows(
    rows,
    ROW_HEIGHT
  );

  return (
    <section className="panel topic-tree">
      <header className="panel-header">
        <h2>Topic Explorer</h2>
        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Filter topics"
        />
      </header>
      <div className="topic-tree-list" ref={containerRef}>
        <div style={{ height: topPadding }} />
        {visibleItems.map(({ item }) => {
          const topic = topics.get(item.fullPath);
          const hasChildren = item.hasChildren;
          const isSelected = item.fullPath === selectedTopic;
          const isRecent = topic ? nowTick - topic.timestamp < RECENT_MS : false;

          return (
            <button
              key={item.key}
              className={`topic-row ${
                isSelected ? "selected" : ""
              } ${isRecent ? "recent-update" : ""} ${
                hasChildren ? "branch-row" : "leaf-row"
              }`}
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
                {!item.isLeaf ? (
                  <span className="branch-meta">
                    {item.topicCount} topics, {item.messageCount} messages
                  </span>
                ) : null}
              </span>
              {item.isLeaf && topic ? (
                <span className="topic-msg-count">{topic.messageCount}</span>
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
