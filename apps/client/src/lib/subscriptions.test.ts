import { describe, expect, it } from "vitest";
import {
  normalizeInitialSubscriptions,
  resolveInitialSubscriptions
} from "./subscriptions";

describe("resolveInitialSubscriptions", () => {
  it("uses configured initial subscriptions", () => {
    const resolved = resolveInitialSubscriptions({
      subscriptionFilter: "ignored/#",
      initialSubscriptions: [
        { topicFilter: "devices/+/status", qos: 1 },
        { topicFilter: "", qos: 2 }
      ]
    });

    expect(resolved).toEqual([{ topicFilter: "devices/+/status", qos: 1 }]);
  });

  it("falls back to subscription filter", () => {
    expect(
      resolveInitialSubscriptions({
        subscriptionFilter: "metrics/#",
        initialSubscriptions: []
      })
    ).toEqual([{ topicFilter: "metrics/#", qos: 0 }]);
  });

  it("falls back to root wildcard", () => {
    expect(resolveInitialSubscriptions({})).toEqual([{ topicFilter: "#", qos: 0 }]);
  });
});

describe("normalizeInitialSubscriptions", () => {
  it("trims and drops empty filters", () => {
    expect(
      normalizeInitialSubscriptions([
        { topicFilter: "  sensors/# ", qos: 0 },
        { topicFilter: "", qos: 2 }
      ])
    ).toEqual([{ topicFilter: "sensors/#", qos: 0 }]);
  });

  it("returns default when all filters are empty", () => {
    expect(
      normalizeInitialSubscriptions([
        { topicFilter: "", qos: 1 },
        { topicFilter: "   ", qos: 2 }
      ])
    ).toEqual([{ topicFilter: "#", qos: 0 }]);
  });
});
