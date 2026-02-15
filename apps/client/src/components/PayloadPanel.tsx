import { useEffect, useMemo, useState } from "react";
import {
  bytesToHex,
  bytesToUtf8,
  isSparkplugTopic,
  tryParseJson
} from "@mqtt-rover/protocol";
import { decodeSparkplugPayload } from "@mqtt-rover/sparkplug";
import { TopicSnapshot } from "../store/useAppStore";

interface Props {
  topic: string | null;
  snapshot: TopicSnapshot | undefined;
  historyEnabled: boolean;
  onToggleHistory: () => void;
  onPublishRetained: (topic: string, payload: string) => Promise<void>;
}

type PayloadView = "json" | "utf8" | "hex" | "sparkplug" | "mqtt5";

export function PayloadPanel({
  topic,
  snapshot,
  historyEnabled,
  onToggleHistory,
  onPublishRetained
}: Props) {
  const [retainedDraft, setRetainedDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeView, setActiveView] = useState<PayloadView>("json");

  useEffect(() => {
    if (!snapshot) {
      setRetainedDraft("");
      return;
    }
    setRetainedDraft(bytesToUtf8(snapshot.payload));
  }, [snapshot]);

  const payloadText = useMemo(() => {
    if (!snapshot) {
      return "";
    }
    return bytesToUtf8(snapshot.payload);
  }, [snapshot]);

  const asJson = useMemo(() => tryParseJson(payloadText), [payloadText]);
  const asHex = useMemo(
    () => (snapshot ? bytesToHex(snapshot.payload) : ""),
    [snapshot]
  );
  const sparkplug = useMemo(() => {
    if (!topic || !snapshot || !isSparkplugTopic(topic)) {
      return null;
    }
    return decodeSparkplugPayload(snapshot.payload);
  }, [snapshot, topic]);
  const viewContent = useMemo(
    () => ({
      json: asJson ? JSON.stringify(asJson, null, 2) : "Not valid JSON payload",
      utf8: payloadText || "<empty>",
      hex: asHex || "<empty>",
      sparkplug: sparkplug
        ? JSON.stringify(sparkplug, null, 2)
        : "Not Sparkplug B payload or decode failed",
      mqtt5: snapshot?.mqtt5
        ? JSON.stringify(snapshot.mqtt5, null, 2)
        : "No MQTT5 properties captured"
    }),
    [asHex, asJson, payloadText, snapshot?.mqtt5, sparkplug]
  );

  useEffect(() => {
    setActiveView((current) => {
      if (current === "hex" || current === "sparkplug" || current === "mqtt5") {
        return current;
      }
      return asJson ? "json" : "utf8";
    });
  }, [topic, snapshot, asJson]);

  if (!topic || !snapshot) {
    return (
      <section className="panel payload-panel">
        <header className="panel-header">
          <h2>Payload Viewer</h2>
        </header>
        <div className="empty-state">Select a topic to inspect payload and history.</div>
      </section>
    );
  }

  return (
    <section className="panel payload-panel">
      <header className="panel-header">
        <h2>Payload Viewer</h2>
        <div className="inline">
          <button type="button" className="button-ghost" onClick={onToggleHistory}>
            {historyEnabled ? "Stop History" : "Start History"}
          </button>
        </div>
      </header>

      <div className="payload-meta">
        <span>
          <strong>Topic:</strong> {topic}
        </span>
        <span>
          <strong>QoS:</strong> {snapshot.qos}
        </span>
        <span>
          <strong>Retain:</strong> {snapshot.retain ? "Yes" : "No"}
        </span>
        <span>
          <strong>Timestamp:</strong> {new Date(snapshot.timestamp).toLocaleTimeString()}
        </span>
      </div>

      <div className="payload-view-switcher">
        <button
          type="button"
          className={activeView === "json" ? "button-primary" : "button-ghost"}
          onClick={() => setActiveView("json")}
        >
          JSON
        </button>
        <button
          type="button"
          className={activeView === "utf8" ? "button-primary" : "button-ghost"}
          onClick={() => setActiveView("utf8")}
        >
          UTF-8
        </button>
        <button
          type="button"
          className={activeView === "hex" ? "button-primary" : "button-ghost"}
          onClick={() => setActiveView("hex")}
        >
          HEX
        </button>
        <button
          type="button"
          className={activeView === "sparkplug" ? "button-primary" : "button-ghost"}
          onClick={() => setActiveView("sparkplug")}
        >
          Sparkplug
        </button>
        <button
          type="button"
          className={activeView === "mqtt5" ? "button-primary" : "button-ghost"}
          onClick={() => setActiveView("mqtt5")}
        >
          MQTT5
        </button>
      </div>

      <div className="payload-viewer">
        <pre>{viewContent[activeView]}</pre>
      </div>

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
