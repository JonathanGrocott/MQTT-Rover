import { FormEvent, useMemo, useState } from "react";
import { ConnectionProfile, OverloadMode, SubscriptionRequest } from "@mqtt-rover/protocol";
import { resolveInitialSubscriptions, normalizeInitialSubscriptions } from "../lib/subscriptions";
import { useAppStore } from "../store/useAppStore";
import { ConnectionStatusRow } from "./connection-toolbar/ConnectionStatusRow";
import { InitialSubscriptionsSection } from "./connection-toolbar/InitialSubscriptionsSection";
import { Mqtt5ConnectPropertiesSection } from "./connection-toolbar/Mqtt5ConnectPropertiesSection";
import { MtlsCredentialsSection } from "./connection-toolbar/MtlsCredentialsSection";
import { ManagedSubscription, RuntimeStats, ViewPreset } from "./connection-toolbar/types";
import { RuntimeSubscriptionsSection } from "./connection-toolbar/RuntimeSubscriptionsSection";
import { hasWebSocketPath, toNumber } from "./connection-toolbar/utils";

interface Props {
  profile: ConnectionProfile | null;
  viewPreset: ViewPreset;
  onChangeViewPreset: (preset: ViewPreset) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  runtimeStats: RuntimeStats;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  subscriptions: ManagedSubscription[];
  subscriptionsDisabled: boolean;
  onSubscribe: (request: SubscriptionRequest) => Promise<void>;
  onUnsubscribe: (topicFilter: string) => Promise<void>;
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
    () => resolveInitialSubscriptions(profile),
    [profile]
  );
  const connectProperties = profile?.mqtt5ConnectProperties ?? {};

  const upsertInitialSubscriptions = (next: SubscriptionRequest[]) => {
    const finalList = normalizeInitialSubscriptions(next);
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
            onChange={(event) => onChangeViewPreset(event.target.value as ViewPreset)}
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

            {hasWebSocketPath(profile) ? (
              <div className="field-group compact">
                <label>Path</label>
                <input
                  value={profile?.path ?? "/mqtt"}
                  onChange={(event) => updateActiveProfile({ path: event.target.value })}
                />
              </div>
            ) : null}

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

          <InitialSubscriptionsSection
            advancedMode={advancedMode}
            subscriptions={initialSubscriptions}
            onChange={upsertInitialSubscriptions}
          />

          <RuntimeSubscriptionsSection
            subscriptions={subscriptions}
            subscriptionsDisabled={subscriptionsDisabled}
            subscriptionBusy={subscriptionBusy}
            setSubscriptionBusy={setSubscriptionBusy}
            subscriptionError={subscriptionError}
            setSubscriptionError={setSubscriptionError}
            isMqtt5={isMqtt5}
            advancedMode={advancedMode}
            onSubscribe={onSubscribe}
            onUnsubscribe={onUnsubscribe}
          />

          <Mqtt5ConnectPropertiesSection
            profileId={profile?.id ?? null}
            isMqtt5={isMqtt5}
            advancedMode={advancedMode}
            connectProperties={connectProperties}
            onChange={(next) => updateActiveProfile({ mqtt5ConnectProperties: next })}
          />
        </>
      )}

      <MtlsCredentialsSection
        collapsed={collapsed}
        advancedMode={advancedMode}
        profile={profile}
        onUpdateProfile={updateActiveProfile}
      />

      <ConnectionStatusRow
        connectionState={connectionState}
        connectionError={connectionError}
        runtimeStats={runtimeStats}
      />
    </form>
  );
}
