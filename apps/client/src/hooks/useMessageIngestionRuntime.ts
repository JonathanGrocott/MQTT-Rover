import { useCallback, useEffect, useRef, useState } from "react";
import { MessageEnvelope, OverloadMode } from "@mqtt-rover/protocol";
import { RuntimeStats } from "../components/connection-toolbar/types";
import { useAppStore } from "../store/useAppStore";

export interface OverloadPreset {
  maxCoalescedTopics: number;
  maxHistoryQueue: number;
  fastFlushLoad: number;
  fastFlushMsgPerSec: number;
  dropNonHistory: "evict-oldest" | "drop-incoming";
  dropHistory: "drop-oldest" | "drop-incoming";
}

interface Args {
  overloadMode: OverloadMode;
  overloadPreset: OverloadPreset;
  ingestMessages: (messages: MessageEnvelope[]) => void;
}

function queueLoad(
  coalescedSize: number,
  historySize: number,
  preset: OverloadPreset
): number {
  const coalescedRatio = coalescedSize / preset.maxCoalescedTopics;
  const historyRatio = historySize / preset.maxHistoryQueue;
  return Math.max(coalescedRatio, historyRatio);
}

export function useMessageIngestionRuntime({
  overloadMode,
  overloadPreset,
  ingestMessages
}: Args) {
  const coalescedMessagesRef = useRef<Map<string, MessageEnvelope>>(new Map());
  const historyMessagesRef = useRef<MessageEnvelope[]>([]);
  const flushHandleRef = useRef<number | null>(null);
  const flushModeRef = useRef<"none" | "raf" | "timeout">("none");
  const droppedCoalescedRef = useRef(0);
  const droppedHistoryRef = useRef(0);
  const lastBatchSizeRef = useRef(0);
  const lastFlushMsRef = useRef(0);
  const incomingCounterRef = useRef(0);
  const incomingRateRef = useRef(0);
  const lastRateTimestampRef = useRef(performance.now());
  const overloadModeRef = useRef(overloadMode);
  const overloadPresetRef = useRef(overloadPreset);
  const ingestMessagesRef = useRef(ingestMessages);

  const [runtimeStats, setRuntimeStats] = useState<RuntimeStats>({
    msgPerSec: 0,
    queued: 0,
    coalescedTopics: 0,
    historyBuffered: 0,
    overloadMode,
    droppedCoalesced: 0,
    droppedHistory: 0,
    lastBatchSize: 0,
    lastFlushMs: 0
  });

  useEffect(() => {
    overloadModeRef.current = overloadMode;
    overloadPresetRef.current = overloadPreset;
    ingestMessagesRef.current = ingestMessages;
  }, [overloadMode, overloadPreset, ingestMessages]);

  const syncRuntimeStats = useCallback(() => {
    setRuntimeStats({
      msgPerSec: incomingRateRef.current,
      queued:
        coalescedMessagesRef.current.size + historyMessagesRef.current.length,
      coalescedTopics: coalescedMessagesRef.current.size,
      historyBuffered: historyMessagesRef.current.length,
      overloadMode: overloadModeRef.current,
      droppedCoalesced: droppedCoalescedRef.current,
      droppedHistory: droppedHistoryRef.current,
      lastBatchSize: lastBatchSizeRef.current,
      lastFlushMs: lastFlushMsRef.current
    });
  }, []);

  const cancelScheduledFlush = useCallback(() => {
    if (flushHandleRef.current === null) {
      return;
    }

    if (flushModeRef.current === "raf") {
      window.cancelAnimationFrame(flushHandleRef.current);
    } else if (flushModeRef.current === "timeout") {
      window.clearTimeout(flushHandleRef.current);
    }

    flushHandleRef.current = null;
    flushModeRef.current = "none";
  }, []);

  const flushQueuedMessages = useCallback(() => {
    flushHandleRef.current = null;
    flushModeRef.current = "none";

    const coalesced = Array.from(coalescedMessagesRef.current.values());
    const history = historyMessagesRef.current;
    if (coalesced.length === 0 && history.length === 0) {
      return;
    }

    coalescedMessagesRef.current.clear();
    historyMessagesRef.current = [];
    const batch = [...coalesced, ...history];
    const startedAt = performance.now();
    ingestMessagesRef.current(batch);
    lastBatchSizeRef.current = batch.length;
    lastFlushMsRef.current = performance.now() - startedAt;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushHandleRef.current !== null) {
      return;
    }

    const preset = overloadPresetRef.current;
    const load = queueLoad(
      coalescedMessagesRef.current.size,
      historyMessagesRef.current.length,
      preset
    );

    const shouldFastFlush =
      load >= preset.fastFlushLoad ||
      incomingRateRef.current >= preset.fastFlushMsgPerSec;

    if (shouldFastFlush) {
      flushModeRef.current = "timeout";
      flushHandleRef.current = window.setTimeout(flushQueuedMessages, 0);
      return;
    }

    flushModeRef.current = "raf";
    flushHandleRef.current = window.requestAnimationFrame(() => {
      flushQueuedMessages();
    });
  }, [flushQueuedMessages]);

  const enqueueMessage = useCallback((message: MessageEnvelope) => {
    incomingCounterRef.current += 1;

    const preset = overloadPresetRef.current;

    if (useAppStore.getState().historyEnabledTopics.has(message.topic)) {
      if (historyMessagesRef.current.length >= preset.maxHistoryQueue) {
        if (preset.dropHistory === "drop-incoming") {
          droppedHistoryRef.current += 1;
          scheduleFlush();
          return;
        }

        const dropCount =
          historyMessagesRef.current.length - preset.maxHistoryQueue + 1;
        historyMessagesRef.current.splice(0, dropCount);
        droppedHistoryRef.current += dropCount;
      }

      historyMessagesRef.current.push(message);
      scheduleFlush();
      return;
    }

    const existing = coalescedMessagesRef.current.has(message.topic);
    if (existing) {
      coalescedMessagesRef.current.set(message.topic, message);
      scheduleFlush();
      return;
    }

    if (coalescedMessagesRef.current.size >= preset.maxCoalescedTopics) {
      if (preset.dropNonHistory === "drop-incoming") {
        droppedCoalescedRef.current += 1;
        scheduleFlush();
        return;
      }

      const oldest = coalescedMessagesRef.current.keys().next().value;
      if (oldest) {
        coalescedMessagesRef.current.delete(oldest);
        droppedCoalescedRef.current += 1;
      }
    }

    coalescedMessagesRef.current.set(message.topic, message);
    scheduleFlush();
  }, [scheduleFlush]);

  const resetRuntimeBuffers = useCallback(() => {
    coalescedMessagesRef.current.clear();
    historyMessagesRef.current = [];
    droppedCoalescedRef.current = 0;
    droppedHistoryRef.current = 0;
    lastBatchSizeRef.current = 0;
    lastFlushMsRef.current = 0;
    incomingCounterRef.current = 0;
    incomingRateRef.current = 0;
    lastRateTimestampRef.current = performance.now();
    cancelScheduledFlush();
  }, [cancelScheduledFlush]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedSec = (now - lastRateTimestampRef.current) / 1000;
      if (elapsedSec >= 1) {
        incomingRateRef.current = incomingCounterRef.current / elapsedSec;
        incomingCounterRef.current = 0;
        lastRateTimestampRef.current = now;
      }
      syncRuntimeStats();
    }, 500);

    return () => {
      window.clearInterval(timer);
      cancelScheduledFlush();
    };
  }, [cancelScheduledFlush, syncRuntimeStats]);

  useEffect(() => {
    syncRuntimeStats();
  }, [overloadMode, syncRuntimeStats]);

  return {
    runtimeStats,
    enqueueMessage,
    resetRuntimeBuffers,
    syncRuntimeStats
  };
}
