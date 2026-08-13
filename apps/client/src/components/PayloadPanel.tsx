import { useEffect, useState } from "react";
import {
  bytesToHex,
  bytesToUtf8,
  isSparkplugTopic,
  tryParseJson
} from "@mqtt-rover/protocol";
import { decodeSparkplugPayload } from "@mqtt-rover/sparkplug";
import { TopicMessageRecord, TopicSnapshot } from "../store/useAppStore";

interface Props {
  topic: string | null;
  snapshot: TopicSnapshot | undefined;
  messageHistory: TopicMessageRecord[];
  historyEnabled: boolean;
  onToggleHistory: () => void;
  onPublishRetained: (topic: string, payload: string) => Promise<void>;
}

type PayloadView = "json" | "utf8" | "hex" | "sparkplug" | "mqtt5";
type CompareMode = "raw" | "diff";

function payloadHistoryPreview(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    return "<empty>";
  }
  const text = bytesToUtf8(bytes).replace(/\s+/g, " ").trim();
  if (!text) {
    return `<${bytes.byteLength} bytes>`;
  }
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function formatPayloadView(
  view: PayloadView,
  topic: string,
  payload: Uint8Array,
  mqtt5?: TopicSnapshot["mqtt5"]
): string {
  const payloadText = bytesToUtf8(payload);
  const asJson = tryParseJson(payloadText);
  const asHex = bytesToHex(payload);
  const sparkplug = isSparkplugTopic(topic)
    ? decodeSparkplugPayload(payload)
    : null;

  switch (view) {
    case "json":
      return asJson ? JSON.stringify(asJson, null, 2) : "Not valid JSON payload";
    case "utf8":
      return payloadText || "<empty>";
    case "hex":
      return asHex || "<empty>";
    case "sparkplug":
      return sparkplug
        ? JSON.stringify(sparkplug, null, 2)
        : "Not Sparkplug B payload or decode failed";
    case "mqtt5":
      return mqtt5 ? JSON.stringify(mqtt5, null, 2) : "No MQTT5 properties captured";
  }
}

function diffPayloads(previous: string, current: string): string {
  if (previous === current) {
    return "No differences detected.";
  }

  const previousLines = previous.split("\n");
  const currentLines = current.split("\n");
  const maxLines = Math.max(previousLines.length, currentLines.length);
  const output: string[] = [];

  for (let index = 0; index < maxLines; index += 1) {
    const left = previousLines[index];
    const right = currentLines[index];
    if (left === right) {
      output.push(`  ${left ?? ""}`);
      continue;
    }
    if (left !== undefined) {
      output.push(`- ${left}`);
    }
    if (right !== undefined) {
      output.push(`+ ${right}`);
    }
  }

  return output.join("\n");
}

export function PayloadPanel({
  topic,
  snapshot,
  messageHistory,
  historyEnabled,
  onToggleHistory,
  onPublishRetained
}: Props) {
  const [retainedDraft, setRetainedDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeView, setActiveView] = useState<PayloadView>("json");
  const [compareMode, setCompareMode] = useState<CompareMode>("raw");
  const [compareSequence, setCompareSequence] = useState<number | null>(null);
  const [topicCopied, setTopicCopied] = useState(false);

  useEffect(() => {
    if (!snapshot) {
      setRetainedDraft("");
      return;
    }
    setRetainedDraft(bytesToUtf8(snapshot.payload));
  }, [snapshot]);

  useEffect(() => {
    setActiveView((current) => {
      if (current === "hex" || current === "sparkplug" || current === "mqtt5") {
        return current;
      }
      if (!snapshot) {
        return "utf8";
      }
      return tryParseJson(bytesToUtf8(snapshot.payload)) ? "json" : "utf8";
    });
  }, [topic, snapshot]);

  useEffect(() => {
    setCompareSequence(null);
    setCompareMode("raw");
  }, [topic]);

  useEffect(() => {
    if (
      compareSequence !== null &&
      !messageHistory.some((entry) => entry.sequence === compareSequence)
    ) {
      setCompareSequence(null);
    }
  }, [compareSequence, messageHistory]);

  if (!topic || !snapshot) {
    return (
      <section className="panel payload-panel">
        <header className="panel-header">
          <h2>Topic Inspector</h2>
        </header>
        <div className="empty-state">Select a topic to inspect payload and history.</div>
      </section>
    );
  }

  const currentRecord = messageHistory[messageHistory.length - 1] ?? null;
  const previousRecord =
    messageHistory.length > 1 ? messageHistory[messageHistory.length - 2] : null;
  const chosenRecord =
    compareSequence !== null
      ? messageHistory.find((entry) => entry.sequence === compareSequence) ?? null
      : previousRecord;
  const compareRecord =
    chosenRecord && currentRecord && chosenRecord.sequence !== currentRecord.sequence
      ? chosenRecord
      : null;

  const compareOptions =
    messageHistory.length > 1
      ? [...messageHistory.slice(0, messageHistory.length - 1)].reverse()
      : [];
  const recentHistory = [...messageHistory].slice(-80).reverse();

  const currentViewContent = formatPayloadView(
    activeView,
    topic,
    snapshot.payload,
    snapshot.mqtt5
  );
  const compareViewContent = compareRecord
    ? formatPayloadView(
        activeView,
        topic,
        compareRecord.payload,
        compareRecord.mqtt5
      )
    : "";
  const viewerContent =
    compareMode === "diff"
      ? compareRecord
        ? diffPayloads(compareViewContent, currentViewContent)
        : "At least two messages are required to compute a diff."
      : currentViewContent;
  const topicSegments = topic.split("/");

  return (
    <section className="panel payload-panel">
      <header className="panel-header">
        <h2>Topic Inspector</h2>
        <div className="inline">
          <button type="button" className="button-ghost" onClick={onToggleHistory}>
            {historyEnabled ? "Stop History" : "Start History"}
          </button>
        </div>
      </header>

      <div className="topic-summary">
        <div className="topic-breadcrumb" aria-label={`Selected topic: ${topic}`}>
          {topicSegments.map((segment, index) => (
            <span className="topic-breadcrumb-part" key={`${segment}-${index}`}>
              {index > 0 ? <span className="topic-breadcrumb-separator">/</span> : null}
              <span className="topic-breadcrumb-chip">{segment || "(empty)"}</span>
            </span>
          ))}
        </div>
        <div className="payload-meta">
          <span>QoS {snapshot.qos}</span>
          <span>{snapshot.retain ? "Retained" : "Live"}</span>
          <span>{new Date(snapshot.timestamp).toLocaleTimeString()}</span>
          <button
            type="button"
            className="topic-copy-button"
            onClick={async () => {
              await navigator.clipboard.writeText(topic);
              setTopicCopied(true);
              window.setTimeout(() => setTopicCopied(false), 1_500);
            }}
          >
            {topicCopied ? "Copied" : "Copy topic"}
          </button>
        </div>
      </div>

      <section className="inspector-section current-value-section">
        <header className="inspector-section-header">
          <h3>Current value</h3>
          <div className="payload-view-switcher">
            {(["json", "utf8", "hex", "sparkplug", "mqtt5"] as PayloadView[]).map(
              (view) => (
                <button
                  type="button"
                  key={view}
                  className={activeView === view ? "button-primary" : "button-ghost"}
                  onClick={() => setActiveView(view)}
                >
                  {view === "utf8" ? "UTF-8" : view === "mqtt5" ? "MQTT5" : view[0].toUpperCase() + view.slice(1)}
                </button>
              )
            )}
          </div>
        </header>

        <div className="payload-compare-controls">
          <span className="payload-compare-label">Compare</span>
          <button
            type="button"
            className={compareMode === "raw" ? "button-primary" : "button-ghost"}
            onClick={() => setCompareMode("raw")}
          >
            Raw
          </button>
          <button
            type="button"
            className={compareMode === "diff" ? "button-primary" : "button-ghost"}
            onClick={() => setCompareMode("diff")}
          >
            Diff
          </button>
          <select
            aria-label="Message to compare"
            value={compareSequence ?? ""}
            onChange={(event) =>
              setCompareSequence(
                event.target.value ? Number(event.target.value) : null
              )
            }
            disabled={compareOptions.length === 0}
          >
            <option value="">Previous message</option>
            {compareOptions.map((entry) => (
              <option key={entry.sequence} value={entry.sequence}>
                {new Date(entry.timestamp).toLocaleTimeString()} qos{entry.qos}
                {entry.retain ? " retain" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="payload-viewer">
          <pre>{viewerContent}</pre>
        </div>
      </section>

      <details className="payload-history">
        <summary>Message History ({messageHistory.length})</summary>
        <div className="payload-history-list">
          {!historyEnabled ? (
            <div className="payload-history-empty">
              Start History to record messages for this topic.
            </div>
          ) : recentHistory.length === 0 ? (
            <div className="payload-history-empty">No messages recorded yet.</div>
          ) : (
            recentHistory.map((entry) => {
              const isCurrent = currentRecord?.sequence === entry.sequence;
              const isCompared = compareRecord?.sequence === entry.sequence;
              return (
                <button
                  key={entry.sequence}
                  type="button"
                  className={`payload-history-row ${
                    isCurrent ? "current" : ""
                  } ${isCompared ? "compare" : ""}`}
                  onClick={() =>
                    setCompareSequence(isCurrent ? null : entry.sequence)
                  }
                >
                  <span className="payload-history-time">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="payload-history-flags">
                    qos{entry.qos} {entry.retain ? "retain" : "live"}
                  </span>
                  <span className="payload-history-preview">
                    {payloadHistoryPreview(entry.payload)}
                  </span>
                  {isCurrent ? (
                    <span className="payload-history-chip">current</span>
                  ) : isCompared ? (
                    <span className="payload-history-chip">compare</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </details>

      <details className="retained-editor">
        <summary>Retained Editor</summary>
        <div className="retained-editor-body">
          <textarea
            rows={5}
            value={retainedDraft}
            onChange={(event) => setRetainedDraft(event.target.value)}
          />
          <button
            className="button-primary"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onPublishRetained(topic, retainedDraft);
              } finally {
                setBusy(false);
              }
            }}
          >
            Publish Retained to Selected Topic
          </button>
        </div>
      </details>
    </section>
  );
}
