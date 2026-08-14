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
  onShowHistoryChart: () => void;
}

type PayloadView = "json" | "utf8" | "hex" | "sparkplug" | "mqtt5";

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

export function PayloadPanel({
  topic,
  snapshot,
  messageHistory,
  historyEnabled,
  onToggleHistory,
  onShowHistoryChart
}: Props) {
  const [activeView, setActiveView] = useState<PayloadView>("json");
  const [viewedSequence, setViewedSequence] = useState<number | null>(null);
  const [topicCopied, setTopicCopied] = useState(false);

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
    setViewedSequence(null);
  }, [topic]);

  useEffect(() => {
    if (
      viewedSequence !== null &&
      !messageHistory.some((entry) => entry.sequence === viewedSequence)
    ) {
      setViewedSequence(null);
    }
  }, [messageHistory, viewedSequence]);

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
  const viewedRecord =
    viewedSequence !== null
      ? messageHistory.find((entry) => entry.sequence === viewedSequence) ?? null
      : null;
  const recentHistory = [...messageHistory].slice(-80).reverse();

  const viewerContent = formatPayloadView(
    activeView,
    topic,
    viewedRecord?.payload ?? snapshot.payload,
    viewedRecord?.mqtt5 ?? snapshot.mqtt5
  );
  const topicSegments = topic.split("/");

  return (
    <section className="panel payload-panel">
      <header className="panel-header">
        <h2>Topic Inspector</h2>
        <div className="inline">
          {historyEnabled ? (
            <>
              <button
                type="button"
                className="button-primary"
                onClick={onShowHistoryChart}
              >
                View Chart
              </button>
              <button type="button" className="button-ghost" onClick={onToggleHistory}>
                Stop History
              </button>
            </>
          ) : (
            <button type="button" className="button-primary" onClick={onToggleHistory}>
              Start History
            </button>
          )}
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
          <h3>{viewedRecord ? "Historical value" : "Current value"}</h3>
          <div className="payload-view-actions">
            {viewedRecord ? (
              <button
                type="button"
                className="button-ghost payload-live-button"
                onClick={() => setViewedSequence(null)}
              >
                Return to live
              </button>
            ) : null}
            <div className="payload-view-switcher">
              {(["json", "utf8", "hex", "sparkplug", "mqtt5"] as PayloadView[]).map(
                (view) => (
                  <button
                    type="button"
                    key={view}
                    className={activeView === view ? "button-primary" : "button-ghost"}
                    onClick={() => setActiveView(view)}
                  >
                    {view === "utf8"
                      ? "UTF-8"
                      : view === "mqtt5"
                        ? "MQTT5"
                        : view[0].toUpperCase() + view.slice(1)}
                  </button>
                )
              )}
            </div>
          </div>
        </header>

        <div className="payload-viewer">
          <pre>{viewerContent}</pre>
        </div>
      </section>

      {historyEnabled ? (
        <details className="payload-history">
          <summary>Message History ({messageHistory.length})</summary>
          <div className="payload-history-list">
            {recentHistory.length === 0 ? (
              <div className="payload-history-empty">No messages recorded yet.</div>
            ) : (
              recentHistory.map((entry) => {
                const isCurrent = currentRecord?.sequence === entry.sequence;
                const isViewed = viewedRecord?.sequence === entry.sequence;
                return (
                  <button
                    key={entry.sequence}
                    type="button"
                    className={`payload-history-row ${
                      isCurrent ? "current" : ""
                    } ${isViewed ? "viewing" : ""}`}
                    onClick={() =>
                      setViewedSequence(isCurrent ? null : entry.sequence)
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
                    ) : isViewed ? (
                      <span className="payload-history-chip">viewing</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </details>
      ) : null}
    </section>
  );
}
