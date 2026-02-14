import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { HistoryPoint } from "../store/useAppStore";

interface Props {
  topic: string | null;
  data: HistoryPoint[];
  collapsed: boolean;
  focused: boolean;
  onToggleCollapsed: () => void;
  onToggleFocused: () => void;
}

export function HistoryPanel({
  topic,
  data,
  collapsed,
  focused,
  onToggleCollapsed,
  onToggleFocused
}: Props) {
  return (
    <section className={`panel history-panel ${collapsed ? "collapsed" : ""}`}>
      <header className="panel-header">
        <h2>History</h2>
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
        <div className="empty-state">History panel collapsed.</div>
      ) : !topic ? (
        <div className="empty-state">Select a topic and click Start History.</div>
      ) : data.length === 0 ? (
        <div className="empty-state">
          Waiting for numeric values on <strong>{topic}</strong>
        </div>
      ) : (
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) =>
                  new Date(Number(value)).toLocaleTimeString([], {
                    hour12: false
                  })
                }
              />
              <YAxis />
              <Tooltip
                labelFormatter={(value) =>
                  new Date(Number(value)).toLocaleTimeString([], {
                    hour12: false
                  })
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
