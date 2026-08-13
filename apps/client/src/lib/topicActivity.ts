export type TopicActivityMode = "off" | "subtle" | "full";

export interface ActivitySignal {
  lastActivityAt: number;
  lastPulseAt: number;
  burstStartedAt: number;
  burstCount: number;
}

export const EMPTY_ACTIVITY_SIGNAL: ActivitySignal = {
  lastActivityAt: 0,
  lastPulseAt: 0,
  burstStartedAt: 0,
  burstCount: 0
};

const BURST_GAP_MS = 1_500;

export function activityPulseCooldown(mode: TopicActivityMode): number {
  if (mode === "full") {
    return 600;
  }
  return mode === "subtle" ? 1_200 : Number.POSITIVE_INFINITY;
}

export function updateActivitySignal(
  previous: ActivitySignal,
  deltaMessages: number,
  now: number,
  mode: TopicActivityMode
): ActivitySignal {
  if (mode === "off" || deltaMessages <= 0) {
    return previous;
  }

  const continuingBurst = now - previous.lastActivityAt <= BURST_GAP_MS;
  const canPulse = now - previous.lastPulseAt >= activityPulseCooldown(mode);
  return {
    lastActivityAt: now,
    lastPulseAt: canPulse ? now : previous.lastPulseAt,
    burstStartedAt: continuingBurst ? previous.burstStartedAt : now,
    burstCount: (continuingBurst ? previous.burstCount : 0) + deltaMessages
  };
}

export function recordActivitySignal(
  signal: ActivitySignal,
  deltaMessages: number,
  now: number,
  mode: TopicActivityMode
): void {
  if (mode === "off" || deltaMessages <= 0) {
    return;
  }
  const continuingBurst = now - signal.lastActivityAt <= BURST_GAP_MS;
  const canPulse = now - signal.lastPulseAt >= activityPulseCooldown(mode);
  signal.lastActivityAt = now;
  if (canPulse) {
    signal.lastPulseAt = now;
  }
  if (!continuingBurst) {
    signal.burstStartedAt = now;
    signal.burstCount = 0;
  }
  signal.burstCount += deltaMessages;
}

export function activityDurations(mode: TopicActivityMode): {
  recentMs: number;
  pulseMs: number;
} {
  if (mode === "full") {
    return { recentMs: 4_500, pulseMs: 520 };
  }
  if (mode === "subtle") {
    return { recentMs: 2_200, pulseMs: 360 };
  }
  return { recentMs: 0, pulseMs: 0 };
}
