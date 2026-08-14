import { HistoryPoint } from "../store/useAppStore";

export interface HistoryOverlayRow {
  timestamp: number;
  [topic: string]: number;
}

export function buildHistoryOverlayData(
  selectedTopics: string[],
  historyByTopic: Map<string, HistoryPoint[]>
): HistoryOverlayRow[] {
  const rowsByTimestamp = new Map<number, HistoryOverlayRow>();

  for (const topic of selectedTopics) {
    for (const point of historyByTopic.get(topic) ?? []) {
      const row = rowsByTimestamp.get(point.timestamp) ?? {
        timestamp: point.timestamp
      };
      row[topic] = point.value;
      rowsByTimestamp.set(point.timestamp, row);
    }
  }

  return Array.from(rowsByTimestamp.values()).sort(
    (left, right) => left.timestamp - right.timestamp
  );
}

export function reconcileSelectedHistoryTopics(
  selectedTopics: string[],
  enabledTopics: string[],
  preferredTopic: string | null
): string[] {
  const enabled = new Set(enabledTopics);
  const retained = selectedTopics.filter((topic) => enabled.has(topic));
  if (retained.length > 0) {
    return retained;
  }
  if (preferredTopic && enabled.has(preferredTopic)) {
    return [preferredTopic];
  }
  return enabledTopics[0] ? [enabledTopics[0]] : [];
}
