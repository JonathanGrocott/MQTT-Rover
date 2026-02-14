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

export function PayloadPanel({
  topic,
  snapshot,
  historyEnabled,
  onToggleHistory,
  onPublishRetained
}: Props) {
  const [retainedDraft, setRetainedDraft] = useState("");
  const [busy, setBusy] = useState(false);

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

      <div className="payload-grid">
        <div>
          <h3>UTF-8</h3>
          <pre>{payloadText || "<empty>"}</pre>
        </div>
        <div>
          <h3>JSON</h3>
          <pre>{asJson ? JSON.stringify(asJson, null, 2) : "Not valid JSON"}</pre>
        </div>
        <div>
          <h3>HEX</h3>
          <pre>{asHex}</pre>
        </div>
        <div>
          <h3>Sparkplug B</h3>
          <pre>
            {sparkplug
              ? JSON.stringify(sparkplug, null, 2)
              : "Not Sparkplug B payload or decode failed"}
          </pre>
        </div>
      </div>

      <div className="retained-editor">
        <h3>Retained Editor</h3>
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
    </section>
  );
}
