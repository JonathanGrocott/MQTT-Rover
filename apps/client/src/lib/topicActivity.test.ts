import { describe, expect, it } from "vitest";
import {
  activityDurations,
  EMPTY_ACTIVITY_SIGNAL,
  recordActivitySignal,
  updateActivitySignal
} from "./topicActivity";

describe("topic activity", () => {
  it("rate limits pulses while retaining burst counts", () => {
    const first = updateActivitySignal(EMPTY_ACTIVITY_SIGNAL, 3, 2_000, "subtle");
    const hot = updateActivitySignal(first, 4, 2_100, "subtle");
    const nextPulse = updateActivitySignal(hot, 2, 3_250, "subtle");

    expect(first.lastPulseAt).toBe(2_000);
    expect(hot.lastPulseAt).toBe(2_000);
    expect(hot.burstCount).toBe(7);
    expect(nextPulse.lastPulseAt).toBe(3_250);
    expect(nextPulse.burstCount).toBe(9);
  });

  it("starts a new burst after a quiet period", () => {
    const first = updateActivitySignal(EMPTY_ACTIVITY_SIGNAL, 8, 1_000, "full");
    const next = updateActivitySignal(first, 2, 2_600, "full");
    expect(next.burstStartedAt).toBe(2_600);
    expect(next.burstCount).toBe(2);
  });

  it("does not retain activity while indications are disabled", () => {
    expect(updateActivitySignal(EMPTY_ACTIVITY_SIGNAL, 10, 2_000, "off")).toBe(
      EMPTY_ACTIVITY_SIGNAL
    );
    expect(activityDurations("off")).toEqual({ recentMs: 0, pulseMs: 0 });
  });

  it("updates worker-owned signals in place without per-message state objects", () => {
    const signal = { ...EMPTY_ACTIVITY_SIGNAL };
    recordActivitySignal(signal, 5, 2_000, "subtle");
    recordActivitySignal(signal, 7, 2_100, "subtle");
    expect(signal).toEqual({
      lastActivityAt: 2_100,
      lastPulseAt: 2_000,
      burstStartedAt: 2_000,
      burstCount: 12
    });
  });
});
