import { ConnectionState } from "@mqtt-rover/protocol";
import { RuntimeStats } from "./types";

interface Props {
  connectionState: ConnectionState;
  connectionError: string | null;
  runtimeStats: RuntimeStats;
}

export function ConnectionStatusRow({
  connectionState,
  connectionError,
  runtimeStats
}: Props) {
  return (
    <div className="status-row">
      <span className={`pill ${connectionState}`}>{connectionState}</span>
      {connectionError ? <span className="error-text">{connectionError}</span> : null}
      <span className="pill telemetry">{runtimeStats.msgPerSec.toFixed(0)} msg/s</span>
      <span className="pill telemetry">{runtimeStats.overloadMode}</span>
      <span className="pill telemetry">queued {runtimeStats.queued}</span>
      <span className="pill telemetry">coalesced {runtimeStats.coalescedTopics}</span>
      <span className="pill telemetry">history {runtimeStats.historyBuffered}</span>
      <span className="pill telemetry">
        flush {runtimeStats.lastBatchSize} / {runtimeStats.lastFlushMs.toFixed(1)}ms
      </span>
      {runtimeStats.droppedCoalesced > 0 || runtimeStats.droppedHistory > 0 ? (
        <span className="pill telemetry dropped">
          dropped {runtimeStats.droppedCoalesced + runtimeStats.droppedHistory}
        </span>
      ) : null}
    </div>
  );
}
