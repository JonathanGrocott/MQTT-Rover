import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { buildHistoryOverlayData, reconcileSelectedHistoryTopics } from "../lib/historyOverlay";
import { HistoryPoint } from "../store/useAppStore";

interface Props {
  enabledTopics: string[];
  historyByTopic: Map<string, HistoryPoint[]>;
  selectedTopic: string | null;
  collapsed: boolean;
  focused: boolean;
  onToggleCollapsed: () => void;
  onToggleFocused: () => void;
  onShowHistory: () => void;
}

const SERIES_COLORS = [
  "#2cc6a3",
  "#36a6ff",
  "#f6c85f",
  "#ff7c91",
  "#a78bfa",
  "#67e8f9",
  "#fb923c",
  "#a3e635"
];

function seriesLabel(topic: string): string {
  const segments = topic.split("/");
  if (segments.length >= 3) {
    const site = segments.find((segment) => /^site-/i.test(segment));
    const device = segments.find((segment) => /^device-/i.test(segment));
    const metric = segments.at(-1);
    return [site, device, metric].filter(Boolean).join(" / ");
  }
  return topic;
}

export function HistoryOverlayPanel({
  enabledTopics,
  historyByTopic,
  selectedTopic,
  collapsed,
  focused,
  onToggleCollapsed,
  onToggleFocused,
  onShowHistory
}: Props) {
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);

  useEffect(() => {
    setSelectedTopics((current) =>
      reconcileSelectedHistoryTopics(current, enabledTopics, selectedTopic)
    );
  }, [enabledTopics, selectedTopic]);

  const chartData = useMemo(
    () => buildHistoryOverlayData(selectedTopics, historyByTopic),
    [historyByTopic, selectedTopics]
  );

  const selectedPointCount = useMemo(
    () =>
      selectedTopics.reduce(
        (total, topic) => total + (historyByTopic.get(topic)?.length ?? 0),
        0
      ),
    [historyByTopic, selectedTopics]
  );

  const exportSelectedHistory = () => {
    const records = selectedTopics.flatMap((topic) =>
      (historyByTopic.get(topic) ?? []).map((point) =>
        ({ topic, timestamp: point.timestamp, value: point.value })
      )
    ).sort((left, right) => left.timestamp - right.timestamp);
    const blob = new Blob([records.map((record) => JSON.stringify(record)).join("\n")], {
      type: "application/x-ndjson"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mqtt-rover-history-${Date.now()}.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={`panel history-panel ${collapsed ? "collapsed" : ""}`}>
      <header className="panel-header">
        <h2>History Overlay</h2>
        <div className="inline">
          <button type="button" className="button-ghost" onClick={onShowHistory}>
            Selected
          </button>
          <button type="button" className="button-ghost" onClick={onToggleCollapsed}>
            {collapsed ? "Expand" : "Collapse"}
          </button>
          <button type="button" className="button-ghost" onClick={onToggleFocused}>
            {focused ? "Exit Focus" : "Focus"}
          </button>
        </div>
      </header>

      {collapsed ? (
        <div className="empty-state">History overlay collapsed.</div>
      ) : enabledTopics.length === 0 ? (
        <div className="empty-state">
          Start History on one or more topics to build an overlay chart.
        </div>
      ) : (
        <div className="history-overlay-body">
          <div className="history-overlay-toolbar">
            <button
              type="button"
              onClick={() => setSelectedTopics(enabledTopics)}
              disabled={selectedTopics.length === enabledTopics.length}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedTopics([])}
              disabled={selectedTopics.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={exportSelectedHistory}
              disabled={selectedPointCount === 0}
            >
              Export selected
            </button>
          </div>

          <div className="history-overlay-topic-list">
            {enabledTopics.map((topic, index) => {
              const checked = selectedTopics.includes(topic);
              const pointCount = historyByTopic.get(topic)?.length ?? 0;
              return (
                <label className="history-overlay-topic" key={topic} title={topic}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      setSelectedTopics((current) =>
                        event.target.checked
                          ? [...current, topic]
                          : current.filter((entry) => entry !== topic)
                      )
                    }
                  />
                  <span
                    className="history-overlay-series-key"
                    style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
                    aria-hidden="true"
                  />
                  <span className="history-overlay-topic-name">{topic}</span>
                  <span className="history-overlay-topic-count">
                    {pointCount.toLocaleString()} pts
                  </span>
                </label>
              );
            })}
          </div>

          <div className="history-overlay-chart">
            {selectedTopics.length === 0 ? (
              <div className="empty-state">Select histories to chart together.</div>
            ) : chartData.length === 0 ? (
              <div className="empty-state">Waiting for numeric history values.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(value) =>
                      new Date(Number(value)).toLocaleTimeString([], { hour12: false })
                    }
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) =>
                      new Date(Number(value)).toLocaleTimeString([], { hour12: false })
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {selectedTopics.map((topic) => {
                    const colorIndex = Math.max(0, enabledTopics.indexOf(topic));
                    return (
                    <Line
                      key={topic}
                      type="monotone"
                      dataKey={topic}
                      name={seriesLabel(topic)}
                      stroke={SERIES_COLORS[colorIndex % SERIES_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      <footer className="panel-footer">
        {enabledTopics.length.toLocaleString()} histories enabled •{" "}
        {selectedTopics.length.toLocaleString()} charted •{" "}
        {selectedPointCount.toLocaleString()} points
      </footer>
    </section>
  );
}
