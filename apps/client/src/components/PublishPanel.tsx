import { FormEvent, useState } from "react";

interface Props {
  selectedTopic: string | null;
  collapsed: boolean;
  focused: boolean;
  onToggleCollapsed: () => void;
  onToggleFocused: () => void;
  onPublish: (request: {
    topic: string;
    payload: string;
    qos: 0 | 1 | 2;
    retain: boolean;
  }) => Promise<void>;
}

export function PublishPanel({
  selectedTopic,
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
  const [busy, setBusy] = useState(false);

  const effectiveTopic = topic || selectedTopic || "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!effectiveTopic) {
      return;
    }

    setBusy(true);
    try {
      await onPublish({
        topic: effectiveTopic,
        payload,
        qos,
        retain
      });
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

        <button className="button-primary" type="submit" disabled={busy || !effectiveTopic}>
          Publish
        </button>
      </form>
      )}
    </section>
  );
}
