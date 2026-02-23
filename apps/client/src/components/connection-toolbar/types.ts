import { OverloadMode, SubscriptionRequest } from "@mqtt-rover/protocol";

export interface RuntimeStats {
  msgPerSec: number;
  queued: number;
  coalescedTopics: number;
  historyBuffered: number;
  overloadMode: OverloadMode;
  droppedCoalesced: number;
  droppedHistory: number;
  lastBatchSize: number;
  lastFlushMs: number;
}

export interface ManagedSubscription extends SubscriptionRequest {
  source: "initial" | "runtime";
}

export type ViewPreset = "simple" | "advanced";
