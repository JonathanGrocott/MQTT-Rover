import { useCallback, useEffect, useRef, useState } from "react";
import { MessageEnvelope } from "@mqtt-rover/protocol";
import { TimelineEntry } from "../components/TimelinePanel";

const TIMELINE_LIMIT = 4000;

type TimelineView = "history" | "timeline";

function clampTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  if (entries.length <= TIMELINE_LIMIT) {
    return entries;
  }
  return entries.slice(entries.length - TIMELINE_LIMIT);
}

export function useTimelineRuntime() {
  const queueRef = useRef<TimelineEntry[]>([]);
  const nextIdRef = useRef(1);
  const pausedRef = useRef(false);
  const replayTimerRef = useRef<number | null>(null);

  const [timelinePaused, setTimelinePaused] = useState(false);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);
  const [rightPanelView, setRightPanelView] = useState<TimelineView>("history");

  useEffect(() => {
    pausedRef.current = timelinePaused;
  }, [timelinePaused]);

  const clearReplayTimer = useCallback(() => {
    if (replayTimerRef.current !== null) {
      window.clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  const appendMessages = useCallback((messages: MessageEnvelope[]) => {
    setTimelineEntries((current) => {
      const mapped = messages.map((message) => ({
        id: nextIdRef.current++,
        message
      }));
      return clampTimeline([...current, ...mapped]);
    });
  }, []);

  const queueLiveMessage = useCallback((message: MessageEnvelope) => {
    if (pausedRef.current) {
      return;
    }

    queueRef.current.push({
      id: nextIdRef.current++,
      message
    });
  }, []);

  const clearTimeline = useCallback(() => {
    clearReplayTimer();
    queueRef.current = [];
    setTimelineEntries([]);
  }, [clearReplayTimer]);

  const resetTimeline = useCallback(() => {
    clearReplayTimer();
    queueRef.current = [];
    nextIdRef.current = 1;
    pausedRef.current = false;
    setTimelineEntries([]);
    setTimelinePaused(false);
  }, [clearReplayTimer]);

  const importTimelineSession = useCallback((
    imported: MessageEnvelope[],
    mode: "append" | "replace" | "replay"
  ) => {
    if (imported.length === 0) {
      return;
    }

    if (mode === "append") {
      appendMessages(imported);
      return;
    }

    if (mode === "replace") {
      clearReplayTimer();
      queueRef.current = [];
      nextIdRef.current = 1;
      setTimelineEntries(
        imported.slice(-TIMELINE_LIMIT).map((message) => ({
          id: nextIdRef.current++,
          message
        }))
      );
      return;
    }

    const replayList = [...imported].sort((left, right) => left.timestamp - right.timestamp);
    clearReplayTimer();
    queueRef.current = [];
    nextIdRef.current = 1;
    setTimelineEntries([]);

    const pausedBeforeReplay = pausedRef.current;
    setTimelinePaused(true);

    let index = 0;
    const pushNext = () => {
      if (index >= replayList.length) {
        replayTimerRef.current = null;
        setTimelinePaused(pausedBeforeReplay);
        return;
      }

      const current = replayList[index];
      if (current) {
        appendMessages([current]);
      }
      index += 1;

      if (index >= replayList.length) {
        replayTimerRef.current = null;
        setTimelinePaused(pausedBeforeReplay);
        return;
      }

      const next = replayList[index];
      const delay = next
        ? Math.max(20, Math.min(280, next.timestamp - (current?.timestamp ?? next.timestamp)))
        : 40;
      replayTimerRef.current = window.setTimeout(pushNext, delay);
    };

    pushNext();
  }, [appendMessages, clearReplayTimer]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current) {
        return;
      }
      const pending = queueRef.current;
      if (pending.length === 0) {
        return;
      }
      queueRef.current = [];
      setTimelineEntries((current) => clampTimeline([...current, ...pending]));
    }, 220);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearReplayTimer();
    };
  }, [clearReplayTimer]);

  return {
    timelinePaused,
    setTimelinePaused,
    timelineEntries,
    rightPanelView,
    setRightPanelView,
    queueLiveMessage,
    clearTimeline,
    resetTimeline,
    importTimelineSession
  };
}
