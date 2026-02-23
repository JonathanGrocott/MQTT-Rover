import { useState } from "react";
import { SubscriptionRequest } from "@mqtt-rover/protocol";
import { ManagedSubscription } from "./types";
import {
  parseUserProperties,
  toOperationErrorMessage,
  toOptionalNumber
} from "./utils";

interface Props {
  subscriptions: ManagedSubscription[];
  subscriptionsDisabled: boolean;
  subscriptionBusy: boolean;
  setSubscriptionBusy: (value: boolean) => void;
  subscriptionError: string | null;
  setSubscriptionError: (value: string | null) => void;
  isMqtt5: boolean;
  advancedMode: boolean;
  onSubscribe: (request: SubscriptionRequest) => Promise<void>;
  onUnsubscribe: (topicFilter: string) => Promise<void>;
}

export function RuntimeSubscriptionsSection({
  subscriptions,
  subscriptionsDisabled,
  subscriptionBusy,
  setSubscriptionBusy,
  subscriptionError,
  setSubscriptionError,
  isMqtt5,
  advancedMode,
  onSubscribe,
  onUnsubscribe
}: Props) {
  const [subscriptionFilter, setSubscriptionFilter] = useState("");
  const [subscriptionQos, setSubscriptionQos] = useState<0 | 1 | 2>(0);
  const [subscriptionNoLocal, setSubscriptionNoLocal] = useState(false);
  const [subscriptionRap, setSubscriptionRap] = useState(false);
  const [subscriptionRh, setSubscriptionRh] = useState<0 | 1 | 2>(0);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [subscriptionUserPropertiesDraft, setSubscriptionUserPropertiesDraft] =
    useState("");

  return (
    <details className="toolbar-accordion" open={advancedMode}>
      <summary>Runtime Subscriptions ({subscriptions.length})</summary>
      <div className="subscription-manager">
        <div className="subscription-controls">
          <input
            value={subscriptionFilter}
            onChange={(event) => setSubscriptionFilter(event.target.value)}
            placeholder="devices/+/status"
            disabled={subscriptionsDisabled || subscriptionBusy}
          />
          <select
            value={subscriptionQos}
            onChange={(event) =>
              setSubscriptionQos(Number(event.target.value) as 0 | 1 | 2)
            }
            disabled={subscriptionsDisabled || subscriptionBusy}
          >
            <option value={0}>QoS 0</option>
            <option value={1}>QoS 1</option>
            <option value={2}>QoS 2</option>
          </select>
          <button
            type="button"
            className="button-primary"
            disabled={
              subscriptionsDisabled ||
              subscriptionBusy ||
              subscriptionFilter.trim().length === 0
            }
            onClick={async () => {
              setSubscriptionBusy(true);
              setSubscriptionError(null);
              try {
                const request: SubscriptionRequest = {
                  topicFilter: subscriptionFilter.trim(),
                  qos: subscriptionQos
                };
                if (isMqtt5) {
                  request.mqtt5 = {
                    noLocal: subscriptionNoLocal,
                    retainAsPublished: subscriptionRap,
                    retainHandling: subscriptionRh,
                    subscriptionIdentifier: toOptionalNumber(subscriptionId),
                    userProperties: parseUserProperties(subscriptionUserPropertiesDraft)
                  };
                }
                await onSubscribe(request);
                setSubscriptionFilter("");
              } catch (error) {
                setSubscriptionError(toOperationErrorMessage(error));
              } finally {
                setSubscriptionBusy(false);
              }
            }}
          >
            Subscribe
          </button>
        </div>

        {isMqtt5 && advancedMode ? (
          <details className="toolbar-sub-accordion">
            <summary>Advanced MQTT5 Subscribe Options</summary>
            <div className="subscription-advanced">
              <label className="retain-toggle">
                <input
                  type="checkbox"
                  checked={subscriptionNoLocal}
                  onChange={(event) => setSubscriptionNoLocal(event.target.checked)}
                  disabled={subscriptionsDisabled || subscriptionBusy}
                />
                No Local
              </label>
              <label className="retain-toggle">
                <input
                  type="checkbox"
                  checked={subscriptionRap}
                  onChange={(event) => setSubscriptionRap(event.target.checked)}
                  disabled={subscriptionsDisabled || subscriptionBusy}
                />
                Retain As Published
              </label>
              <label>
                RH
                <select
                  value={subscriptionRh}
                  onChange={(event) =>
                    setSubscriptionRh(Number(event.target.value) as 0 | 1 | 2)
                  }
                  disabled={subscriptionsDisabled || subscriptionBusy}
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
              <label>
                Sub Identifier
                <input
                  value={subscriptionId}
                  onChange={(event) => setSubscriptionId(event.target.value)}
                  placeholder="optional"
                  disabled={subscriptionsDisabled || subscriptionBusy}
                />
              </label>
              <label>
                User Props (key=value)
                <textarea
                  rows={2}
                  value={subscriptionUserPropertiesDraft}
                  onChange={(event) =>
                    setSubscriptionUserPropertiesDraft(event.target.value)
                  }
                  disabled={subscriptionsDisabled || subscriptionBusy}
                />
              </label>
            </div>
          </details>
        ) : null}

        {subscriptionError ? <div className="error-text">{subscriptionError}</div> : null}

        <div className="subscription-list">
          {subscriptions.length === 0 ? (
            <span className="subscription-empty">No active subscriptions</span>
          ) : (
            subscriptions.map((entry) => (
              <div className="subscription-chip" key={`runtime-${entry.topicFilter}`}>
                <span>
                  {entry.topicFilter} (QoS {entry.qos})
                </span>
                {entry.mqtt5 ? (
                  <span className="subscription-source">mqtt5</span>
                ) : null}
                <span className="subscription-source">{entry.source}</span>
                <button
                  type="button"
                  className="button-ghost"
                  disabled={subscriptionsDisabled || subscriptionBusy}
                  onClick={async () => {
                    setSubscriptionBusy(true);
                    setSubscriptionError(null);
                    try {
                      await onUnsubscribe(entry.topicFilter);
                    } catch (error) {
                      setSubscriptionError(toOperationErrorMessage(error));
                    } finally {
                      setSubscriptionBusy(false);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </details>
  );
}
