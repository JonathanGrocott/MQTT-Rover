import { useEffect, useRef, useState } from "react";
import { TopicSnapshot, useAppStore } from "../store/useAppStore";
import { useVirtualRows } from "../hooks/useVirtualRows";
import { TopicRow, TopicWorkerResponse } from "../types/topicRows";

interface Props {
  selectedTopic: string | null;
  topics: Map<string, TopicSnapshot>;
}

const ROW_HEIGHT = 26;
const HIGHLIGHT_MS = 7000;
const FLASH_MS = 1400;

interface PathHighlight {
  startedAt: number;
  expiresAt: number;
  pendingMessages: number;
}

function topicToPaths(topic: string): string[] {
  const segments = topic.split("/");
  const paths: string[] = [];
  let cursor = "";

  for (const segment of segments) {
    const next = cursor ? `${cursor}/${segment}` : segment;
    cursor = next;
    if (next.length > 0) {
      paths.push(next);
    }
  }

  return paths;
}

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
  const [rows, setRows] = useState<TopicRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const [pathHighlights, setPathHighlights] = useState<Map<string, PathHighlight>>(
    () => new Map()
  );
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
    if (topics.size === 0) {
      setPathHighlights(new Map());
    }
  }, [topics]);

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
      const now = Date.now();
      setPathHighlights((previous) => {
        const next = new Map(previous);

        for (const update of pendingTopicDeltas) {
          for (const path of topicToPaths(update.topic)) {
            const existing = next.get(path);
            const carryExisting = existing && existing.expiresAt > now;
            next.set(path, {
              startedAt: carryExisting ? existing.startedAt : now,
              expiresAt: now + HIGHLIGHT_MS,
              pendingMessages: (carryExisting ? existing.pendingMessages : 0) + update.deltaMessages
            });
          }
        }

        return next;
      });
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
          const highlight = pathHighlights.get(item.fullPath);
          const isRecent = Boolean(highlight && nowTick < highlight.expiresAt);
          const isFlashing = Boolean(
            highlight && nowTick - highlight.startedAt >= 0 && nowTick - highlight.startedAt < FLASH_MS
          );

          return (
            <button
              key={item.key}
              className={`topic-row ${
                isSelected ? "selected" : ""
              } ${isRecent ? "recent-update" : ""} ${isFlashing ? "flash-update" : ""} ${
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
              {isRecent && highlight ? (
                <span className="new-msg-chip">+{formatBurstCount(highlight.pendingMessages)}</span>
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
