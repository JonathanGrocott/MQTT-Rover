import { describe, expect, it } from "vitest";
import {
  buildHistoryOverlayData,
  reconcileSelectedHistoryTopics
} from "./historyOverlay";

describe("history overlay", () => {
  it("combines selected topic histories by timestamp", () => {
    const history = new Map([
      ["factory/temperature", [{ timestamp: 10, value: 20 }]],
      [
        "factory/pressure",
        [
          { timestamp: 10, value: 40 },
          { timestamp: 20, value: 42 }
        ]
      ]
    ]);

    expect(
      buildHistoryOverlayData(
        ["factory/temperature", "factory/pressure"],
        history
      )
    ).toEqual([
      {
        timestamp: 10,
        "factory/temperature": 20,
        "factory/pressure": 40
      },
      { timestamp: 20, "factory/pressure": 42 }
    ]);
  });

  it("keeps only enabled selections and falls back to the preferred topic", () => {
    expect(
      reconcileSelectedHistoryTopics(
        ["disabled/topic"],
        ["enabled/topic", "second/topic"],
        "second/topic"
      )
    ).toEqual(["second/topic"]);
  });
});
