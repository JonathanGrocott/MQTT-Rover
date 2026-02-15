import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ConnectionProfile,
  Mqtt5UserProperty,
  OverloadMode,
  SubscriptionRequest
} from "@mqtt-rover/protocol";
import { useAppStore } from "../store/useAppStore";

interface ManagedSubscription extends SubscriptionRequest {
  source: "initial" | "runtime";
}

interface Props {
  profile: ConnectionProfile | null;
  viewPreset: "simple" | "advanced";
  onChangeViewPreset: (preset: "simple" | "advanced") => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  runtimeStats: {
    msgPerSec: number;
    queued: number;
    coalescedTopics: number;
    historyBuffered: number;
    overloadMode: OverloadMode;
    droppedCoalesced: number;
    droppedHistory: number;
    lastBatchSize: number;
    lastFlushMs: number;
  };
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  subscriptions: ManagedSubscription[];
  subscriptionsDisabled: boolean;
  onSubscribe: (request: SubscriptionRequest) => Promise<void>;
  onUnsubscribe: (topicFilter: string) => Promise<void>;
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Operation failed";
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

function serializeUserProperties(properties?: Mqtt5UserProperty[]): string {
  if (!properties || properties.length === 0) {
    return "";
  }
  return properties.map((entry) => `${entry.key}=${entry.value}`).join("\n");
}

function normalizeInitialSubscriptions(profile: ConnectionProfile | null): SubscriptionRequest[] {
  const configured =
    profile?.initialSubscriptions?.filter(
      (entry) => entry.topicFilter.trim().length > 0
    ) ?? [];
  if (configured.length > 0) {
    return configured;
  }

  const fallback = profile?.subscriptionFilter?.trim() || "#";
  return [{ topicFilter: fallback, qos: 0 }];
}

export function ConnectionToolbar({
  profile,
  viewPreset,
  onChangeViewPreset,
  collapsed,
  onToggleCollapsed,
  runtimeStats,
  onConnect,
  onDisconnect,
  subscriptions,
  subscriptionsDisabled,
  onSubscribe,
  onUnsubscribe
}: Props) {
  const profiles = useAppStore((state) => state.profiles);
  const activeProfileId = useAppStore((state) => state.activeProfileId);
  const connectionState = useAppStore((state) => state.connectionState);
  const connectionError = useAppStore((state) => state.connectionError);
  const setActiveProfile = useAppStore((state) => state.setActiveProfile);
  const createProfile = useAppStore((state) => state.createProfile);
  const removeActiveProfile = useAppStore((state) => state.removeActiveProfile);
  const updateActiveProfile = useAppStore((state) => state.updateActiveProfile);
  const [initialFilterDraft, setInitialFilterDraft] = useState("");
  const [initialQosDraft, setInitialQosDraft] = useState<0 | 1 | 2>(0);
  const [subscriptionFilter, setSubscriptionFilter] = useState("");
  const [subscriptionQos, setSubscriptionQos] = useState<0 | 1 | 2>(0);
  const [subscriptionNoLocal, setSubscriptionNoLocal] = useState(false);
  const [subscriptionRap, setSubscriptionRap] = useState(false);
  const [subscriptionRh, setSubscriptionRh] = useState<0 | 1 | 2>(0);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [subscriptionUserPropertiesDraft, setSubscriptionUserPropertiesDraft] =
    useState("");
  const [connectUserPropertiesDraft, setConnectUserPropertiesDraft] = useState("");
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  const onProtocolSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";
  const isMqtt5 = (profile?.mqttProtocolVersion ?? 4) === 5;
  const advancedMode = viewPreset === "advanced";
  const initialSubscriptions = useMemo(
    () => normalizeInitialSubscriptions(profile),
    [profile]
  );
  const connectProperties = profile?.mqtt5ConnectProperties ?? {};

  useEffect(() => {
    setConnectUserPropertiesDraft(
      serializeUserProperties(connectProperties.userProperties)
    );
  }, [profile?.id, connectProperties.userProperties]);

  const upsertInitialSubscriptions = (next: SubscriptionRequest[]) => {
    const normalized = next
      .map((entry) => ({
        ...entry,
        topicFilter: entry.topicFilter.trim()
      }))
      .filter((entry) => entry.topicFilter.length > 0);
    const finalList: SubscriptionRequest[] =
      normalized.length > 0
        ? normalized
        : [{ topicFilter: "#", qos: 0 as 0 | 1 | 2 }];
    updateActiveProfile({
      initialSubscriptions: finalList,
      subscriptionFilter: finalList[0]?.topicFilter ?? "#"
    });
  };

  return (
    <form className="connection-toolbar" onSubmit={onProtocolSubmit}>
      <div className="toolbar-topline">
        <strong>Connections</strong>
        <div className="inline">
          <select
            value={viewPreset}
            onChange={(event) =>
              onChangeViewPreset(event.target.value as "simple" | "advanced")
            }
          >
            <option value="simple">Simple</option>
            <option value="advanced">Advanced</option>
          </select>
          <button type="button" className="button-ghost" onClick={onToggleCollapsed}>
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      {collapsed ? (
        <div className="toolbar-collapsed">
          <div className="field-group compact">
            <label>Profile</label>
            <select
              value={activeProfileId ?? ""}
              onChange={(event) => setActiveProfile(event.target.value)}
            >
              {profiles.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button
              className="button-primary"
              type="button"
              disabled={isConnecting || isConnected}
              onClick={() => onConnect()}
            >
              Connect
            </button>
            <button
              className="button-ghost"
              type="button"
              disabled={!isConnected && !isConnecting}
              onClick={() => onDisconnect()}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="toolbar-main">
            <div className="field-group compact">
              <label>Profile</label>
              <div className="inline">
                <select
                  value={activeProfileId ?? ""}
                  onChange={(event) => setActiveProfile(event.target.value)}
                >
                  {profiles.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => createProfile()}>
                  New
                </button>
                <button
                  type="button"
                  onClick={() => removeActiveProfile()}
                  disabled={profiles.length <= 1}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="field-group compact">
              <label>Name</label>
              <input
                value={profile?.name ?? ""}
                onChange={(event) => updateActiveProfile({ name: event.target.value })}
              />
            </div>

            <div className="field-group compact">
              <label>Protocol</label>
              <select
                value={profile?.protocol ?? "ws"}
                onChange={(event) =>
                  updateActiveProfile({
                    protocol: event.target.value as ConnectionProfile["protocol"]
                  })
                }
              >
                <option value="ws">ws</option>
                <option value="wss">wss</option>
                <option value="mqtt">mqtt (desktop)</option>
                <option value="mqtts">mqtts (desktop)</option>
              </select>
            </div>

            <div className="field-group compact tiny">
              <label>MQTT Version</label>
              <select
                value={profile?.mqttProtocolVersion ?? 4}
                onChange={(event) =>
                  updateActiveProfile({
                    mqttProtocolVersion: Number(event.target.value) as 4 | 5
                  })
                }
              >
                <option value={4}>3.1.1</option>
                <option value={5}>5.0</option>
              </select>
            </div>

            <div className="field-group compact">
              <label>Host</label>
              <input
                value={profile?.host ?? ""}
                onChange={(event) => updateActiveProfile({ host: event.target.value })}
              />
            </div>

            <div className="field-group compact tiny">
              <label>Port</label>
              <input
                value={profile?.port ?? 1883}
                onChange={(event) =>
                  updateActiveProfile({ port: toNumber(event.target.value, 1883) })
                }
              />
            </div>

            {(profile?.protocol === "ws" || profile?.protocol === "wss") && (
              <div className="field-group compact">
                <label>Path</label>
                <input
                  value={profile?.path ?? "/mqtt"}
                  onChange={(event) => updateActiveProfile({ path: event.target.value })}
                />
              </div>
            )}

            <div className="field-group compact">
              <label>Username</label>
              <input
                value={profile?.username ?? ""}
                onChange={(event) =>
                  updateActiveProfile({ username: event.target.value })
                }
              />
            </div>

            <div className="field-group compact">
              <label>Password</label>
              <input
                type="password"
                value={profile?.password ?? ""}
                onChange={(event) =>
                  updateActiveProfile({ password: event.target.value })
                }
              />
            </div>

            <div className="field-group compact mtls">
              <label>Overload Mode</label>
              <select
                value={profile?.overloadMode ?? "balanced"}
                onChange={(event) =>
                  updateActiveProfile({
                    overloadMode: event.target.value as OverloadMode
                  })
                }
              >
                <option value="balanced">Balanced</option>
                <option value="history-priority">History Priority</option>
                <option value="latest-only">Latest Only</option>
              </select>
            </div>

            <div className="field-group compact mtls">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(profile?.useMtls)}
                  onChange={(event) =>
                    updateActiveProfile({ useMtls: event.target.checked })
                  }
                />
                mTLS
              </label>
            </div>

            <div className="actions">
              <button
                className="button-primary"
                type="button"
                disabled={isConnecting || isConnected}
                onClick={() => onConnect()}
              >
                Connect
              </button>
              <button
                className="button-ghost"
                type="button"
                disabled={!isConnected && !isConnecting}
                onClick={() => onDisconnect()}
              >
                Disconnect
              </button>
            </div>
          </div>

          {advancedMode ? (
          <details className="toolbar-accordion">
            <summary>Initial Subscriptions ({initialSubscriptions.length})</summary>
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
                  upsertInitialSubscriptions([
                    ...initialSubscriptions.filter(
                      (entry) => entry.topicFilter !== nextFilter
                    ),
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
                  upsertInitialSubscriptions([
                    { topicFilter: "#", qos: 0 },
                    ...initialSubscriptions.filter((entry) => entry.topicFilter !== "#")
                  ])
                }
              >
                Add All
              </button>
              <button
                type="button"
                onClick={() =>
                  upsertInitialSubscriptions([
                    { topicFilter: "spBv1.0/#", qos: 0 },
                    ...initialSubscriptions.filter(
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
                  upsertInitialSubscriptions([
                    { topicFilter: "+/+/+", qos: 0 },
                    ...initialSubscriptions.filter(
                      (entry) => entry.topicFilter !== "+/+/+"
                    )
                  ])
                }
              >
                Add 3-level
              </button>
            </div>
            <div className="subscription-list">
              {initialSubscriptions.map((entry) => (
                <div className="subscription-chip" key={`initial-${entry.topicFilter}`}>
                  <span>{entry.topicFilter}</span>
                  <select
                    value={entry.qos}
                    onChange={(event) =>
                      upsertInitialSubscriptions(
                        initialSubscriptions.map((current) =>
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
                      upsertInitialSubscriptions(
                        initialSubscriptions.filter(
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
          ) : null}

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
                        userProperties: parseUserProperties(
                          subscriptionUserPropertiesDraft
                        )
                      };
                    }
                    await onSubscribe(request);
                    setSubscriptionFilter("");
                  } catch (error) {
                    setSubscriptionError(toErrorMessage(error));
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

            {subscriptionError ? (
              <div className="error-text">{subscriptionError}</div>
            ) : null}

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
                          setSubscriptionError(toErrorMessage(error));
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

          {isMqtt5 && advancedMode ? (
            <details className="toolbar-accordion">
              <summary>MQTT5 Connect Properties</summary>
              <div className="toolbar-secondary">
              <div className="field-group">
                <label>MQTT5 Session Expiry (s)</label>
                <input
                  value={connectProperties.sessionExpiryInterval ?? ""}
                  onChange={(event) =>
                    updateActiveProfile({
                      mqtt5ConnectProperties: {
                        ...connectProperties,
                        sessionExpiryInterval: toOptionalNumber(event.target.value)
                      }
                    })
                  }
                />
              </div>
              <div className="field-group">
                <label>MQTT5 Receive Maximum</label>
                <input
                  value={connectProperties.receiveMaximum ?? ""}
                  onChange={(event) =>
                    updateActiveProfile({
                      mqtt5ConnectProperties: {
                        ...connectProperties,
                        receiveMaximum: toOptionalNumber(event.target.value)
                      }
                    })
                  }
                />
              </div>
              <div className="field-group">
                <label>MQTT5 Topic Alias Max</label>
                <input
                  value={connectProperties.topicAliasMaximum ?? ""}
                  onChange={(event) =>
                    updateActiveProfile({
                      mqtt5ConnectProperties: {
                        ...connectProperties,
                        topicAliasMaximum: toOptionalNumber(event.target.value)
                      }
                    })
                  }
                />
              </div>
              <div className="field-group">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(connectProperties.requestResponseInformation)}
                    onChange={(event) =>
                      updateActiveProfile({
                        mqtt5ConnectProperties: {
                          ...connectProperties,
                          requestResponseInformation: event.target.checked
                        }
                      })
                    }
                  />
                  Request Response Info
                </label>
              </div>
              <div className="field-group">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(connectProperties.requestProblemInformation)}
                    onChange={(event) =>
                      updateActiveProfile({
                        mqtt5ConnectProperties: {
                          ...connectProperties,
                          requestProblemInformation: event.target.checked
                        }
                      })
                    }
                  />
                  Request Problem Info
                </label>
              </div>
              <div className="field-group">
                <label>MQTT5 User Props (key=value)</label>
                <textarea
                  rows={2}
                  value={connectUserPropertiesDraft}
                  onChange={(event) => {
                    setConnectUserPropertiesDraft(event.target.value);
                    updateActiveProfile({
                      mqtt5ConnectProperties: {
                        ...connectProperties,
                        userProperties: parseUserProperties(event.target.value)
                      }
                    });
                  }}
                />
              </div>
              </div>
            </details>
          ) : null}
        </>
      )}

      {!collapsed && profile?.useMtls && (
        <details className="toolbar-accordion" open={advancedMode}>
          <summary>mTLS Credentials</summary>
          <div className="toolbar-secondary">
          <div className="field-group">
            <label>CA PEM (required for desktop mTLS)</label>
            <textarea
              rows={2}
              value={profile.caCertPem ?? ""}
              onChange={(event) =>
                updateActiveProfile({ caCertPem: event.target.value })
              }
              placeholder="-----BEGIN CERTIFICATE-----"
            />
          </div>
          <div className="field-group">
            <label>Client Cert PEM</label>
            <textarea
              rows={2}
              value={profile.clientCertPem ?? ""}
              onChange={(event) =>
                updateActiveProfile({ clientCertPem: event.target.value })
              }
            />
          </div>
          <div className="field-group">
            <label>Client Key PEM</label>
            <textarea
              rows={2}
              value={profile.clientKeyPem ?? ""}
              onChange={(event) =>
                updateActiveProfile({ clientKeyPem: event.target.value })
              }
            />
          </div>
          </div>
        </details>
      )}

      <div className="status-row">
        <span className={`pill ${connectionState}`}>{connectionState}</span>
        {connectionError ? <span className="error-text">{connectionError}</span> : null}
        <span className="pill telemetry">{runtimeStats.msgPerSec.toFixed(0)} msg/s</span>
        <span className="pill telemetry">{runtimeStats.overloadMode}</span>
        <span className="pill telemetry">queued {runtimeStats.queued}</span>
        <span className="pill telemetry">
          coalesced {runtimeStats.coalescedTopics}
        </span>
        <span className="pill telemetry">
          history {runtimeStats.historyBuffered}
        </span>
        <span className="pill telemetry">
          flush {runtimeStats.lastBatchSize} / {runtimeStats.lastFlushMs.toFixed(1)}ms
        </span>
        {runtimeStats.droppedCoalesced > 0 || runtimeStats.droppedHistory > 0 ? (
          <span className="pill telemetry dropped">
            dropped {runtimeStats.droppedCoalesced + runtimeStats.droppedHistory}
          </span>
        ) : null}
      </div>
    </form>
  );
}
