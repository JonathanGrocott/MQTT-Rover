import { useEffect, useMemo, useRef, useState } from "react";
import { bytesToHex, bytesToUtf8, MessageEnvelope } from "@mqtt-rover/protocol";

export interface TimelineEntry {
  id: number;
  message: MessageEnvelope;
}

interface Props {
  messages: TimelineEntry[];
  advancedMode: boolean;
  collapsed: boolean;
  focused: boolean;
  paused: boolean;
  onToggleCollapsed: () => void;
  onToggleFocused: () => void;
  onTogglePaused: () => void;
  onClear: () => void;
  onImportSession: (
    entries: MessageEnvelope[],
    mode: "append" | "replace" | "replay"
  ) => void;
  onShowHistory: () => void;
}

type QosFilter = "all" | "0" | "1" | "2";
type RetainFilter = "all" | "retain" | "live";

interface TimelinePrefs {
  topicFilter: string;
  payloadFilter: string;
  qosFilter: QosFilter;
  retainFilter: RetainFilter;
  mqtt5Only: boolean;
  bookmarksOnly: boolean;
  useRegex: boolean;
  showDiff: boolean;
}

const PREFS_KEY = "mqtt-rover.timeline.prefs.v1";
const BOOKMARKS_KEY = "mqtt-rover.timeline.bookmarks.v1";

const DEFAULT_PREFS: TimelinePrefs = {
  topicFilter: "",
  payloadFilter: "",
  qosFilter: "all",
  retainFilter: "all",
  mqtt5Only: false,
  bookmarksOnly: false,
  useRegex: false,
  showDiff: true
};

function parseHexPayload(input: string): Uint8Array {
  const normalized = input.replace(/\s+/g, "").toLowerCase();
  if (normalized.length === 0) {
    return new Uint8Array();
  }

  const pairs =
    normalized.length % 2 === 0 ? normalized : `0${normalized}`;
  const bytes = new Uint8Array(pairs.length / 2);
  for (let index = 0; index < pairs.length; index += 2) {
    const chunk = pairs.slice(index, index + 2);
    const parsed = Number.parseInt(chunk, 16);
    bytes[index / 2] = Number.isFinite(parsed) ? parsed : 0;
  }
  return bytes;
}

function parseImportedMessage(line: string): MessageEnvelope | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const topic =
      typeof parsed.topic === "string" && parsed.topic.trim().length > 0
        ? parsed.topic
        : null;
    if (!topic) {
      return null;
    }

    const qosRaw = Number(parsed.qos);
    const qos: 0 | 1 | 2 =
      qosRaw === 2 ? 2 : qosRaw === 1 ? 1 : 0;
    const timestampRaw = Number(parsed.timestamp);
    const timestamp = Number.isFinite(timestampRaw) ? timestampRaw : Date.now();

    const payload =
      typeof parsed.payloadHex === "string"
        ? new Uint8Array(parseHexPayload(parsed.payloadHex))
        : typeof parsed.payloadUtf8 === "string"
          ? new Uint8Array(new TextEncoder().encode(parsed.payloadUtf8))
          : new Uint8Array();

    return {
      topic,
      payload,
      qos,
      retain: Boolean(parsed.retain),
      timestamp,
      mqtt5:
        parsed.mqtt5 && typeof parsed.mqtt5 === "object"
          ? (parsed.mqtt5 as MessageEnvelope["mqtt5"])
          : undefined
    };
  } catch {
    return null;
  }
}

function loadPrefs(): TimelinePrefs {
  if (typeof window === "undefined") {
    return DEFAULT_PREFS;
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) {
      return DEFAULT_PREFS;
    }
    const parsed = JSON.parse(raw) as Partial<TimelinePrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadBookmarks(): number[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function diffPayloads(left: string, right: string): string {
  if (left === right) {
    return "Payloads are identical.";
  }

  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const maxLines = Math.max(leftLines.length, rightLines.length);
  const output: string[] = [];

  for (let index = 0; index < maxLines; index += 1) {
    const a = leftLines[index];
    const b = rightLines[index];
    if (a === b) {
      output.push(`  ${a ?? ""}`);
      continue;
    }
    if (a !== undefined) {
      output.push(`- ${a}`);
    }
    if (b !== undefined) {
      output.push(`+ ${b}`);
    }
  }

  return output.join("\n");
}

export function TimelinePanel({
  messages,
  advancedMode,
  collapsed,
  focused,
  paused,
  onToggleCollapsed,
  onToggleFocused,
  onTogglePaused,
  onClear,
  onImportSession,
  onShowHistory
}: Props) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importMode, setImportMode] = useState<"append" | "replace" | "replay">(
    "append"
  );
  const [prefs, setPrefs] = useState<TimelinePrefs>(DEFAULT_PREFS);
  const [bookmarkedIds, setBookmarkedIds] = useState<number[]>([]);
  const [leftId, setLeftId] = useState<number | null>(null);
  const [rightId, setRightId] = useState<number | null>(null);

  useEffect(() => {
    setPrefs(loadPrefs());
    setBookmarkedIds(loadBookmarks());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarkedIds));
  }, [bookmarkedIds]);

  const { filteredMessages, filterError } = useMemo(() => {
    const normalizedTopicFilter = prefs.topicFilter.trim().toLowerCase();
    const normalizedPayloadFilter = prefs.payloadFilter.trim().toLowerCase();
    let topicRegex: RegExp | null = null;

    if (prefs.useRegex && prefs.topicFilter.trim().length > 0) {
      try {
        topicRegex = new RegExp(prefs.topicFilter.trim());
      } catch {
        return {
          filteredMessages: [] as TimelineEntry[],
          filterError: "Invalid regex pattern"
        };
      }
    }

    const bookmarkSet = new Set(bookmarkedIds);
    const matches = messages.filter((entry) => {
      if (prefs.bookmarksOnly && !bookmarkSet.has(entry.id)) {
        return false;
      }

      if (topicRegex) {
        if (!topicRegex.test(entry.message.topic)) {
          return false;
        }
      } else if (normalizedTopicFilter.length > 0) {
        if (!entry.message.topic.toLowerCase().includes(normalizedTopicFilter)) {
          return false;
        }
      }

      if (normalizedPayloadFilter.length > 0) {
        const payload = bytesToUtf8(entry.message.payload).toLowerCase();
        if (!payload.includes(normalizedPayloadFilter)) {
          return false;
        }
      }

      if (prefs.qosFilter !== "all" && String(entry.message.qos) !== prefs.qosFilter) {
        return false;
      }

      if (prefs.retainFilter === "retain" && !entry.message.retain) {
        return false;
      }

      if (prefs.retainFilter === "live" && entry.message.retain) {
        return false;
      }

      if (prefs.mqtt5Only && !entry.message.mqtt5) {
        return false;
      }

      return true;
    });

    return {
      filteredMessages: [...matches].reverse().slice(0, 600),
      filterError: null
    };
  }, [bookmarkedIds, messages, prefs]);

  const selectedLeft = useMemo(
    () => messages.find((entry) => entry.id === leftId) ?? null,
    [leftId, messages]
  );
  const selectedRight = useMemo(
    () => messages.find((entry) => entry.id === rightId) ?? null,
    [rightId, messages]
  );

  useEffect(() => {
    if (leftId !== null && !messages.some((entry) => entry.id === leftId)) {
      setLeftId(null);
    }
    if (rightId !== null && !messages.some((entry) => entry.id === rightId)) {
      setRightId(null);
    }
  }, [leftId, rightId, messages]);

  useEffect(() => {
    const existing = new Set(messages.map((entry) => entry.id));
    setBookmarkedIds((current) => current.filter((id) => existing.has(id)));
  }, [messages]);

  const leftPayloadText = selectedLeft
    ? bytesToUtf8(selectedLeft.message.payload)
    : "";
  const rightPayloadText = selectedRight
    ? bytesToUtf8(selectedRight.message.payload)
    : "";
  const payloadDiff =
    selectedLeft && selectedRight
      ? diffPayloads(leftPayloadText, rightPayloadText)
      : "Choose A and B messages to view a payload diff.";
  const bookmarkSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);

  const openImportPicker = (mode: "append" | "replace" | "replay") => {
    setImportMode(mode);
    importInputRef.current?.click();
  };

  return (
    <section className={`panel history-panel ${collapsed ? "collapsed" : ""}`}>
      <header className="panel-header">
        <h2>Timeline</h2>
        <div className="inline">
          <button type="button" className="button-ghost" onClick={onShowHistory}>
            Chart
          </button>
          <button type="button" className="button-ghost" onClick={onToggleCollapsed}>
            {collapsed ? "Expand" : "Collapse"}
          </button>
          <button type="button" className="button-ghost" onClick={onToggleFocused}>
            {focused ? "Exit Focus" : "Focus"}
          </button>
        </div>
      </header>

      {collapsed ? (
        <div className="empty-state">Timeline panel collapsed.</div>
      ) : (
        <div className="timeline-body">
          <input
            ref={importInputRef}
            type="file"
            accept=".jsonl,.ndjson,application/x-ndjson,application/json"
            className="timeline-file-input"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              const text = await file.text();
              const entries = text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line) => parseImportedMessage(line))
                .filter((entry): entry is MessageEnvelope => Boolean(entry));
              onImportSession(entries, importMode);
              event.target.value = "";
            }}
          />
          <div className="timeline-controls">
            <input
              value={prefs.topicFilter}
              onChange={(event) =>
                setPrefs((current) => ({ ...current, topicFilter: event.target.value }))
              }
              placeholder="Filter timeline by topic"
            />
            <button type="button" onClick={onTogglePaused}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" onClick={onClear}>
              Clear
            </button>
            <button type="button" onClick={() => openImportPicker("append")}>
              Import JSONL
            </button>
            <button
              type="button"
              className={prefs.showDiff ? "button-primary" : "button-ghost"}
              onClick={() =>
                setPrefs((current) => ({ ...current, showDiff: !current.showDiff }))
              }
            >
              {prefs.showDiff ? "Hide Diff" : "Show Diff"}
            </button>
            <button
              type="button"
              onClick={() => {
                const lines = filteredMessages.map((entry) =>
                  JSON.stringify({
                    timestamp: entry.message.timestamp,
                    topic: entry.message.topic,
                    qos: entry.message.qos,
                    retain: entry.message.retain,
                    payloadUtf8: bytesToUtf8(entry.message.payload),
                    payloadHex: bytesToHex(entry.message.payload),
                    mqtt5: entry.message.mqtt5
                  })
                );
                const blob = new Blob([lines.join("\n")], {
                  type: "application/x-ndjson"
                });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `mqtt-rover-timeline-${Date.now()}.jsonl`;
                anchor.click();
                URL.revokeObjectURL(url);
              }}
              disabled={filteredMessages.length === 0}
            >
              Export JSONL
            </button>
            {advancedMode ? (
            <details className="timeline-advanced">
              <summary>Advanced Filters</summary>
              <div className="timeline-advanced-grid">
                <div className="timeline-import-actions">
                  <button type="button" onClick={() => openImportPicker("replace")}>
                    Replace With Import
                  </button>
                  <button type="button" onClick={() => openImportPicker("replay")}>
                    Replay Import
                  </button>
                </div>
                <label>
                  Payload Contains
                  <input
                    value={prefs.payloadFilter}
                    onChange={(event) =>
                      setPrefs((current) => ({
                        ...current,
                        payloadFilter: event.target.value
                      }))
                    }
                  />
                </label>
                <label>
                  QoS
                  <select
                    value={prefs.qosFilter}
                    onChange={(event) =>
                      setPrefs((current) => ({
                        ...current,
                        qosFilter: event.target.value as QosFilter
                      }))
                    }
                  >
                    <option value="all">all</option>
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </label>
                <label>
                  Retain
                  <select
                    value={prefs.retainFilter}
                    onChange={(event) =>
                      setPrefs((current) => ({
                        ...current,
                        retainFilter: event.target.value as RetainFilter
                      }))
                    }
                  >
                    <option value="all">all</option>
                    <option value="retain">retain only</option>
                    <option value="live">live only</option>
                  </select>
                </label>
                <label className="retain-toggle">
                  <input
                    type="checkbox"
                    checked={prefs.mqtt5Only}
                    onChange={(event) =>
                      setPrefs((current) => ({
                        ...current,
                        mqtt5Only: event.target.checked
                      }))
                    }
                  />
                  MQTT5 only
                </label>
                <label className="retain-toggle">
                  <input
                    type="checkbox"
                    checked={prefs.bookmarksOnly}
                    onChange={(event) =>
                      setPrefs((current) => ({
                        ...current,
                        bookmarksOnly: event.target.checked
                      }))
                    }
                  />
                  Bookmarks only
                </label>
                <label className="retain-toggle">
                  <input
                    type="checkbox"
                    checked={prefs.useRegex}
                    onChange={(event) =>
                      setPrefs((current) => ({
                        ...current,
                        useRegex: event.target.checked
                      }))
                    }
                  />
                  Topic filter as regex
                </label>
                <button
                  type="button"
                  onClick={() => setBookmarkedIds([])}
                  disabled={bookmarkedIds.length === 0}
                >
                  Clear Bookmarks
                </button>
              </div>
            </details>
            ) : null}
          </div>

          {filterError ? <div className="error-text">{filterError}</div> : null}

          <div className={`timeline-grid ${prefs.showDiff ? "" : "single"}`.trim()}>
            <div className="timeline-list">
              {filteredMessages.map((entry) => (
                <div key={entry.id} className="timeline-row">
                  <div className="timeline-row-main">
                    <span className="timeline-topic">{entry.message.topic}</span>
                    <span className="timeline-meta">
                      {new Date(entry.message.timestamp).toLocaleTimeString()} • qos{" "}
                      {entry.message.qos} • {entry.message.retain ? "retain" : "live"}
                    </span>
                  </div>
                  <div className="timeline-row-actions">
                    <button
                      type="button"
                      aria-label={
                        bookmarkSet.has(entry.id)
                          ? "Remove message bookmark"
                          : "Bookmark message"
                      }
                      title={
                        bookmarkSet.has(entry.id)
                          ? "Remove bookmark"
                          : "Bookmark message"
                      }
                      className={
                        bookmarkSet.has(entry.id) ? "button-primary" : "button-ghost"
                      }
                      onClick={() =>
                        setBookmarkedIds((current) =>
                          current.includes(entry.id)
                            ? current.filter((id) => id !== entry.id)
                            : [...current, entry.id]
                        )
                      }
                    >
                      ★
                    </button>
                    <button
                      type="button"
                      aria-label="Use message as comparison A"
                      title="Use as comparison A"
                      className={leftId === entry.id ? "button-primary" : "button-ghost"}
                      onClick={() => setLeftId(entry.id)}
                    >
                      A
                    </button>
                    <button
                      type="button"
                      aria-label="Use message as comparison B"
                      title="Use as comparison B"
                      className={rightId === entry.id ? "button-primary" : "button-ghost"}
                      onClick={() => setRightId(entry.id)}
                    >
                      B
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {prefs.showDiff ? (
              <div className="timeline-diff">
                <h3>Payload Diff (A vs B)</h3>
                <pre>{payloadDiff}</pre>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <footer className="panel-footer">
        <span>
          {messages.length.toLocaleString()} captured • {filteredMessages.length.toLocaleString()}{" "}
          visible • {bookmarkedIds.length.toLocaleString()} bookmarked
        </span>
      </footer>
    </section>
  );
}
