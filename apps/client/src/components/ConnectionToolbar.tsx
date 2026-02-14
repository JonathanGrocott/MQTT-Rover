import { FormEvent } from "react";
import { ConnectionProfile, OverloadMode } from "@mqtt-rover/protocol";
import { useAppStore } from "../store/useAppStore";

interface Props {
  profile: ConnectionProfile | null;
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
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ConnectionToolbar({
  profile,
  collapsed,
  onToggleCollapsed,
  runtimeStats,
  onConnect,
  onDisconnect
}: Props) {
  const profiles = useAppStore((state) => state.profiles);
  const activeProfileId = useAppStore((state) => state.activeProfileId);
  const connectionState = useAppStore((state) => state.connectionState);
  const connectionError = useAppStore((state) => state.connectionError);
  const setActiveProfile = useAppStore((state) => state.setActiveProfile);
  const createProfile = useAppStore((state) => state.createProfile);
  const removeActiveProfile = useAppStore((state) => state.removeActiveProfile);
  const updateActiveProfile = useAppStore((state) => state.updateActiveProfile);

  const onProtocolSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";

  return (
    <form className="connection-toolbar" onSubmit={onProtocolSubmit}>
      <div className="toolbar-topline">
        <strong>Connections</strong>
        <button type="button" className="button-ghost" onClick={onToggleCollapsed}>
          {collapsed ? "Show" : "Hide"}
        </button>
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
            onChange={(event) => updateActiveProfile({ username: event.target.value })}
          />
        </div>

        <div className="field-group compact">
          <label>Password</label>
          <input
            type="password"
            value={profile?.password ?? ""}
            onChange={(event) => updateActiveProfile({ password: event.target.value })}
          />
        </div>

        <div className="field-group compact">
          <label>Subscribe</label>
          <input
            value={profile?.subscriptionFilter ?? "#"}
            onChange={(event) =>
              updateActiveProfile({ subscriptionFilter: event.target.value })
            }
            placeholder="#"
          />
          <div className="inline">
            <button
              type="button"
              onClick={() => updateActiveProfile({ subscriptionFilter: "#" })}
            >
              All
            </button>
            <button
              type="button"
              onClick={() =>
                updateActiveProfile({ subscriptionFilter: "spBv1.0/#" })
              }
            >
              Sparkplug
            </button>
            <button
              type="button"
              onClick={() => updateActiveProfile({ subscriptionFilter: "+/+/+" })}
            >
              3-level
            </button>
          </div>
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
              onChange={(event) => updateActiveProfile({ useMtls: event.target.checked })}
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
        </>
      )}

      {!collapsed && profile?.useMtls && (
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
