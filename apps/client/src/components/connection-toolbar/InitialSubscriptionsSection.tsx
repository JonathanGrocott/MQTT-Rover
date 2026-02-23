import { useState } from "react";
import { SubscriptionRequest } from "@mqtt-rover/protocol";

interface Props {
  advancedMode: boolean;
  subscriptions: SubscriptionRequest[];
  onChange: (next: SubscriptionRequest[]) => void;
}

export function InitialSubscriptionsSection({
  advancedMode,
  subscriptions,
  onChange
}: Props) {
  const [initialFilterDraft, setInitialFilterDraft] = useState("");
  const [initialQosDraft, setInitialQosDraft] = useState<0 | 1 | 2>(0);

  if (!advancedMode) {
    return null;
  }

  return (
    <details className="toolbar-accordion">
      <summary>Initial Subscriptions ({subscriptions.length})</summary>
      <div className="subscription-manager">
        <div className="subscription-controls">
          <input
            value={initialFilterDraft}
            onChange={(event) => setInitialFilterDraft(event.target.value)}
            placeholder="topic filter"
          />
          <select
            value={initialQosDraft}
            onChange={(event) =>
              setInitialQosDraft(Number(event.target.value) as 0 | 1 | 2)
            }
          >
            <option value={0}>QoS 0</option>
            <option value={1}>QoS 1</option>
            <option value={2}>QoS 2</option>
          </select>
          <button
            type="button"
            onClick={() => {
              const nextFilter = initialFilterDraft.trim();
              if (!nextFilter) {
                return;
              }
              onChange([
                ...subscriptions.filter((entry) => entry.topicFilter !== nextFilter),
                { topicFilter: nextFilter, qos: initialQosDraft }
              ]);
              setInitialFilterDraft("");
            }}
          >
            Add
          </button>
        </div>
        <div className="inline">
          <button
            type="button"
            onClick={() =>
              onChange([
                { topicFilter: "#", qos: 0 },
                ...subscriptions.filter((entry) => entry.topicFilter !== "#")
              ])
            }
          >
            Add All
          </button>
          <button
            type="button"
            onClick={() =>
              onChange([
                { topicFilter: "spBv1.0/#", qos: 0 },
                ...subscriptions.filter(
                  (entry) => entry.topicFilter !== "spBv1.0/#"
                )
              ])
            }
          >
            Add Sparkplug
          </button>
          <button
            type="button"
            onClick={() =>
              onChange([
                { topicFilter: "+/+/+", qos: 0 },
                ...subscriptions.filter((entry) => entry.topicFilter !== "+/+/+")
              ])
            }
          >
            Add 3-level
          </button>
        </div>
        <div className="subscription-list">
          {subscriptions.map((entry) => (
            <div className="subscription-chip" key={`initial-${entry.topicFilter}`}>
              <span>{entry.topicFilter}</span>
              <select
                value={entry.qos}
                onChange={(event) =>
                  onChange(
                    subscriptions.map((current) =>
                      current.topicFilter === entry.topicFilter
                        ? {
                            ...current,
                            qos: Number(event.target.value) as 0 | 1 | 2
                          }
                        : current
                    )
                  )
                }
              >
                <option value={0}>qos0</option>
                <option value={1}>qos1</option>
                <option value={2}>qos2</option>
              </select>
              <button
                type="button"
                className="button-ghost"
                onClick={() =>
                  onChange(
                    subscriptions.filter(
                      (current) => current.topicFilter !== entry.topicFilter
                    )
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
