import { FormEvent, useState } from "react";
import { Mqtt5UserProperty, PublishRequest } from "@mqtt-rover/protocol";

interface Props {
  selectedTopic: string | null;
  mqtt5Enabled: boolean;
  advancedMode: boolean;
  collapsed: boolean;
  focused: boolean;
  onToggleCollapsed: () => void;
  onToggleFocused: () => void;
  onPublish: (request: PublishRequest) => Promise<void>;
}

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseUserProperties(input: string): Mqtt5UserProperty[] | undefined {
  const entries = input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 0) {
        return null;
      }
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (!key) {
        return null;
      }
      return { key, value };
    })
    .filter((entry): entry is Mqtt5UserProperty => Boolean(entry));

  return entries.length > 0 ? entries : undefined;
}

export function PublishPanel({
  selectedTopic,
  mqtt5Enabled,
  advancedMode,
  collapsed,
  focused,
  onToggleCollapsed,
  onToggleFocused,
  onPublish
}: Props) {
  const [topic, setTopic] = useState("");
  const [payload, setPayload] = useState("");
  const [qos, setQos] = useState<0 | 1 | 2>(0);
  const [retain, setRetain] = useState(false);
  const [payloadFormatIndicator, setPayloadFormatIndicator] = useState("");
  const [messageExpiry, setMessageExpiry] = useState("");
  const [topicAlias, setTopicAlias] = useState("");
  const [responseTopic, setResponseTopic] = useState("");
  const [correlationData, setCorrelationData] = useState("");
  const [contentType, setContentType] = useState("");
  const [userPropertiesDraft, setUserPropertiesDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const effectiveTopic = topic || selectedTopic || "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!effectiveTopic) {
      return;
    }

    setBusy(true);
    try {
      const request: PublishRequest = {
        topic: effectiveTopic,
        payload,
        qos,
        retain
      };
      if (mqtt5Enabled) {
        request.mqtt5 = {
          payloadFormatIndicator:
            payloadFormatIndicator === ""
              ? undefined
              : (Number(payloadFormatIndicator) as 0 | 1),
          messageExpiryInterval: toOptionalNumber(messageExpiry),
          topicAlias: toOptionalNumber(topicAlias),
          responseTopic: responseTopic.trim() || undefined,
          correlationData: correlationData.trim() || undefined,
          contentType: contentType.trim() || undefined,
          userProperties: parseUserProperties(userPropertiesDraft)
        };
      }
      await onPublish(request);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`panel publish-panel ${collapsed ? "collapsed" : ""}`}>
      <header className="panel-header">
        <h2>Publish</h2>
        <div className="inline">
          <button type="button" className="button-ghost" onClick={onToggleCollapsed}>
            {collapsed ? "Expand" : "Collapse"}
          </button>
          <button type="button" className="button-ghost" onClick={onToggleFocused}>
            {focused ? "Exit Focus" : "Focus"}
          </button>
        </div>
      </header>
      {collapsed ? (
        <div className="empty-state">Publish panel collapsed.</div>
      ) : (
      <form className="publish-form" onSubmit={submit}>
        <label>
          Topic
          <input
            value={effectiveTopic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="devices/line1/temp"
          />
        </label>
        <label>
          Payload
          <textarea
            rows={4}
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            placeholder='{"value": 42.1}'
          />
        </label>
        <div className="inline publish-controls">
          <label>
            QoS
            <select
              value={qos}
              onChange={(event) => setQos(Number(event.target.value) as 0 | 1 | 2)}
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
          <label className="retain-toggle">
            <input
              type="checkbox"
              checked={retain}
              onChange={(event) => setRetain(event.target.checked)}
            />
            Retain
          </label>
        </div>

        {mqtt5Enabled && advancedMode ? (
          <details className="publish-accordion">
            <summary>Advanced MQTT5 Properties</summary>
            <div className="publish-mqtt5">
              <div className="publish-mqtt5-grid">
                <label>
                  Payload Format
                  <select
                    value={payloadFormatIndicator}
                    onChange={(event) => setPayloadFormatIndicator(event.target.value)}
                  >
                    <option value="">unset</option>
                    <option value="0">0 (binary)</option>
                    <option value="1">1 (utf-8)</option>
                  </select>
                </label>
                <label>
                  Message Expiry (s)
                  <input
                    value={messageExpiry}
                    onChange={(event) => setMessageExpiry(event.target.value)}
                  />
                </label>
                <label>
                  Topic Alias
                  <input
                    value={topicAlias}
                    onChange={(event) => setTopicAlias(event.target.value)}
                  />
                </label>
                <label>
                  Response Topic
                  <input
                    value={responseTopic}
                    onChange={(event) => setResponseTopic(event.target.value)}
                  />
                </label>
                <label>
                  Correlation Data
                  <input
                    value={correlationData}
                    onChange={(event) => setCorrelationData(event.target.value)}
                  />
                </label>
                <label>
                  Content Type
                  <input
                    value={contentType}
                    onChange={(event) => setContentType(event.target.value)}
                  />
                </label>
              </div>
              <label>
                User Props (key=value)
                <textarea
                  rows={2}
                  value={userPropertiesDraft}
                  onChange={(event) => setUserPropertiesDraft(event.target.value)}
                />
              </label>
            </div>
          </details>
        ) : null}

        <button className="button-primary" type="submit" disabled={busy || !effectiveTopic}>
          Publish
        </button>
      </form>
      )}
    </section>
  );
}
