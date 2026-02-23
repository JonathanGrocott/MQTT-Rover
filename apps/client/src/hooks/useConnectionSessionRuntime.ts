import { useCallback, useEffect, useState } from "react";
import {
  ConnectionState,
  ConnectionProfile,
  MessageEnvelope,
  PublishRequest,
  SubscriptionRequest
} from "@mqtt-rover/protocol";
import { ManagedSubscription } from "../components/connection-toolbar/types";
import { errorMessage } from "../lib/errors";
import { mqttRuntime } from "../lib/mqttRuntime";
import { resolveInitialSubscriptions } from "../lib/subscriptions";

interface Args {
  profile: ConnectionProfile | null;
  connectionState: ConnectionState;
  setConnectionState: (
    state: ConnectionState,
    error?: string | null
  ) => void;
  clearRuntimeData: () => void;
  resetRuntimeBuffers: () => void;
  resetTimeline: () => void;
  syncRuntimeStats: () => void;
  queueLiveMessage: (message: MessageEnvelope) => void;
  enqueueMessage: (message: MessageEnvelope) => void;
}

export function useConnectionSessionRuntime({
  profile,
  connectionState,
  setConnectionState,
  clearRuntimeData,
  resetRuntimeBuffers,
  resetTimeline,
  syncRuntimeStats,
  queueLiveMessage,
  enqueueMessage
}: Args) {
  const [subscriptions, setSubscriptions] = useState<ManagedSubscription[]>([]);

  useEffect(() => {
    if (connectionState !== "connected") {
      setSubscriptions([]);
    }
  }, [connectionState]);

  const connect = useCallback(async () => {
    if (!profile) {
      return;
    }

    resetRuntimeBuffers();
    resetTimeline();
    syncRuntimeStats();

    clearRuntimeData();
    setConnectionState("connecting");

    try {
      const initialSubscriptions = resolveInitialSubscriptions(profile);
      const connectProfile = {
        ...profile,
        subscriptionFilter: profile.subscriptionFilter?.trim() || "#",
        initialSubscriptions
      };
      await mqttRuntime.connect(connectProfile, {
        onMessage: (message) => {
          queueLiveMessage(message);
          enqueueMessage(message);
        },
        onState: (state) => {
          setConnectionState(state);
          if (state === "connected") {
            setSubscriptions(
              connectProfile.initialSubscriptions.map((entry) => ({
                ...entry,
                source: "initial"
              }))
            );
          } else if (state === "disconnected") {
            setSubscriptions([]);
          }
        },
        onError: (message) => {
          setConnectionState("error", message);
        }
      });
    } catch (error) {
      const message = errorMessage(error);
      setConnectionState("error", message);
    }
  }, [
    clearRuntimeData,
    enqueueMessage,
    profile,
    queueLiveMessage,
    resetRuntimeBuffers,
    resetTimeline,
    setConnectionState,
    syncRuntimeStats
  ]);

  const disconnect = useCallback(async () => {
    await mqttRuntime.disconnect();
    resetRuntimeBuffers();
    resetTimeline();
    syncRuntimeStats();
    setConnectionState("disconnected");
    setSubscriptions([]);
  }, [
    resetRuntimeBuffers,
    resetTimeline,
    setConnectionState,
    syncRuntimeStats
  ]);

  const publish = useCallback(async (request: PublishRequest) => {
    await mqttRuntime.publish(request);
  }, []);

  const subscribe = useCallback(async (request: SubscriptionRequest) => {
    await mqttRuntime.subscribe(request);
    setSubscriptions((current) => {
      const existingIndex = current.findIndex(
        (entry) => entry.topicFilter === request.topicFilter
      );
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = { ...request, source: "runtime" };
        return next;
      }
      return [...current, { ...request, source: "runtime" }];
    });
  }, []);

  const unsubscribe = useCallback(async (topicFilter: string) => {
    await mqttRuntime.unsubscribe(topicFilter);
    setSubscriptions((current) =>
      current.filter((entry) => entry.topicFilter !== topicFilter)
    );
  }, []);

  return {
    subscriptions,
    connect,
    disconnect,
    publish,
    subscribe,
    unsubscribe
  };
}
