import { ConnectionState } from "@mqtt-rover/protocol";
import { RuntimeStats } from "./connection-toolbar/types";
import { useAppStore } from "../store/useAppStore";

interface Props {
  profileName: string;
  connectionState: ConnectionState;
  runtimeStats: RuntimeStats;
  connectionsOpen: boolean;
  publishOpen: boolean;
  historyOpen: boolean;
  onToggleConnections: () => void;
  onTogglePublish: () => void;
  onToggleHistory: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function WorkspaceHeader({
  profileName,
  connectionState,
  runtimeStats,
  connectionsOpen,
  publishOpen,
  historyOpen,
  onToggleConnections,
  onTogglePublish,
  onToggleHistory,
  onConnect,
  onDisconnect
}: Props) {
  const searchTerm = useAppStore((state) => state.searchTerm);
  const setSearchTerm = useAppStore((state) => state.setSearchTerm);
  const connected = connectionState === "connected";
  const connecting = connectionState === "connecting";

  return (
    <header className="workspace-header">
      <div className="workspace-brand">
        <strong>MQTT Rover</strong>
        <span className="workspace-profile" title={profileName}>
          {profileName}
        </span>
        <span className={`connection-badge ${connectionState}`}>
          {connectionState}
        </span>
      </div>

      <label className="workspace-search">
        <span className="visually-hidden">Filter topics</span>
        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search topics"
        />
      </label>

      <div className="workspace-actions">
        <span className="throughput-readout">
          {runtimeStats.msgPerSec.toFixed(0)} msg/s
        </span>
        <button
          type="button"
          className={connectionsOpen ? "toolbar-action active" : "toolbar-action"}
          aria-pressed={connectionsOpen}
          onClick={onToggleConnections}
        >
          Connections
        </button>
        <button
          type="button"
          className={publishOpen ? "toolbar-action active" : "toolbar-action"}
          aria-pressed={publishOpen}
          onClick={onTogglePublish}
        >
          Publish
        </button>
        <button
          type="button"
          className={historyOpen ? "toolbar-action active" : "toolbar-action"}
          aria-pressed={historyOpen}
          onClick={onToggleHistory}
        >
          History
        </button>
        <button
          type="button"
          className={connected ? "button-ghost connection-action" : "button-primary connection-action"}
          disabled={connecting}
          onClick={() => (connected ? onDisconnect() : onConnect())}
        >
          {connecting ? "Connecting…" : connected ? "Disconnect" : "Connect"}
        </button>
      </div>
    </header>
  );
}
