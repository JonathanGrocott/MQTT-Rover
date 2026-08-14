import { beforeEach, describe, expect, it } from "vitest";
import { MessageEnvelope } from "@mqtt-rover/protocol";
import { useAppStore } from "./useAppStore";

const encoder = new TextEncoder();

function message(topic: string, value: number): MessageEnvelope {
  return {
    topic,
    payload: encoder.encode(JSON.stringify({ value })),
    qos: 0,
    retain: false,
    timestamp: value
  };
}

describe("topic history storage", () => {
  beforeEach(() => {
    useAppStore.setState({ historyEnabledTopics: new Set() });
    useAppStore.getState().clearRuntimeData();
  });

  it("keeps only the latest topic snapshot when history is not enabled", () => {
    const topic = "factory/line-1/temperature";
    useAppStore.getState().ingestMessages(
      Array.from({ length: 300 }, (_, index) => message(topic, index))
    );

    const state = useAppStore.getState();
    expect(state.topics.get(topic)?.messageCount).toBe(300);
    expect(state.topics.get(topic)?.preview).toContain("299");
    expect(state.messageHistoryByTopic.has(topic)).toBe(false);
    expect(state.historyByTopic.has(topic)).toBe(false);
    expect(state.messageSequence).toBe(0);
  });

  it("records bounded history only after opt-in and releases it on stop", () => {
    const topic = "factory/line-1/pressure";
    const store = useAppStore.getState();
    store.toggleHistoryForTopic(topic);
    store.ingestMessages(
      Array.from({ length: 300 }, (_, index) => message(topic, index))
    );

    let state = useAppStore.getState();
    expect(state.messageHistoryByTopic.get(topic)).toHaveLength(240);
    expect(state.historyByTopic.get(topic)).toHaveLength(300);
    expect(state.messageSequence).toBe(300);

    state.toggleHistoryForTopic(topic);
    state = useAppStore.getState();
    expect(state.historyEnabledTopics.has(topic)).toBe(false);
    expect(state.messageHistoryByTopic.has(topic)).toBe(false);
    expect(state.historyByTopic.has(topic)).toBe(false);
  });

  it("publishes a new chart series reference when another value arrives", () => {
    const topic = "factory/line-1/flow";
    const store = useAppStore.getState();
    store.toggleHistoryForTopic(topic);
    store.ingestMessages([message(topic, 1)]);

    const firstSeries = useAppStore.getState().historyByTopic.get(topic);
    expect(firstSeries).toEqual([{ timestamp: 1, value: 1 }]);

    useAppStore.getState().ingestMessages([message(topic, 2)]);
    const secondSeries = useAppStore.getState().historyByTopic.get(topic);

    expect(secondSeries).not.toBe(firstSeries);
    expect(secondSeries).toEqual([
      { timestamp: 1, value: 1 },
      { timestamp: 2, value: 2 }
    ]);
  });
});
