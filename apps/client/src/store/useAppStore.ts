import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ConnectionProfile,
  ConnectionState,
  MessageEnvelope,
  SubscriptionRequest,
  tryExtractNumericValue
} from "@mqtt-rover/protocol";
import { getElectronBridge } from "../desktop/electronBridge";
import { TopicActivityMode } from "../lib/topicActivity";

export interface TopicTreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TopicTreeNode>;
  isLeaf: boolean;
}

export interface TopicSnapshot {
  topic: string;
  payload: Uint8Array;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
  mqtt5?: MessageEnvelope["mqtt5"];
  preview: string;
  messageCount: number;
}

export interface HistoryPoint {
  timestamp: number;
  value: number;
}

export interface TopicMessageRecord {
  sequence: number;
  topic: string;
  payload: Uint8Array;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
  mqtt5?: MessageEnvelope["mqtt5"];
}

export interface TopicCountDelta {
  topic: string;
  deltaMessages: number;
}

interface PersistedSlice {
  profiles: ConnectionProfile[];
  activeProfileId: string | null;
  expandedPaths: string[];
  historyEnabledTopics: string[];
  topicActivityMode?: TopicActivityMode;
}

interface AppState {
  profiles: ConnectionProfile[];
  activeProfileId: string | null;
  connectionState: ConnectionState;
  connectionError: string | null;
  root: TopicTreeNode;
  topics: Map<string, TopicSnapshot>;
  topicRevision: number;
  selectedTopic: string | null;
  expandedPaths: Set<string>;
  searchTerm: string;
  historyEnabledTopics: Set<string>;
  historyByTopic: Map<string, HistoryPoint[]>;
  messageHistoryByTopic: Map<string, TopicMessageRecord[]>;
  messageSequence: number;
  pendingNewTopics: string[];
  pendingTopicCountDeltas: TopicCountDelta[];
  topicStatsRevision: number;
  topicActivityMode: TopicActivityMode;
  setConnectionState: (state: ConnectionState, error?: string | null) => void;
  setSearchTerm: (value: string) => void;
  setSelectedTopic: (topic: string | null) => void;
  toggleExpanded: (path: string) => void;
  upsertProfile: (profile: ConnectionProfile) => void;
  createProfile: () => void;
  removeActiveProfile: () => void;
  clearProfileSecrets: (profileIds: string[]) => void;
  setActiveProfile: (id: string) => void;
  updateActiveProfile: (patch: Partial<ConnectionProfile>) => void;
  ingestMessages: (messages: MessageEnvelope[]) => void;
  drainPendingNewTopics: () => string[];
  drainPendingTopicCountDeltas: () => TopicCountDelta[];
  clearRuntimeData: () => void;
  toggleHistoryForTopic: (topic: string) => void;
  setTopicActivityMode: (mode: TopicActivityMode) => void;
}

const defaultProfile = (): ConnectionProfile => ({
  id: createId(),
  name: "Local Mosquitto",
  protocol: "ws",
  mqttProtocolVersion: 4,
  host: "localhost",
  port: 9001,
  path: "/mqtt",
  clean: true,
  keepalive: 30,
  reconnectPeriodMs: 1000,
  subscriptionFilter: "#",
  initialSubscriptions: [{ topicFilter: "#", qos: 0 }],
  overloadMode: "balanced",
  useMtls: false
});

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.round(Math.random() * 1e7)}`;
}

function normalizeProfile(profile: ConnectionProfile): ConnectionProfile {
  const normalizedInitialSubscriptions =
    profile.initialSubscriptions
      ?.map((entry): SubscriptionRequest | null => {
        const topicFilter = entry.topicFilter?.trim();
        if (!topicFilter) {
          return null;
        }
        return {
          topicFilter,
          qos: entry.qos ?? 0,
          mqtt5: entry.mqtt5
        };
      })
      .filter((entry): entry is SubscriptionRequest => Boolean(entry)) ?? [];

  const subscriptionFilter = profile.subscriptionFilter?.trim();
  if (normalizedInitialSubscriptions.length === 0) {
    normalizedInitialSubscriptions.push({
      topicFilter:
        subscriptionFilter && subscriptionFilter.length > 0
          ? subscriptionFilter
          : "#",
      qos: 0
    });
  }

  const primaryFilter = normalizedInitialSubscriptions[0]?.topicFilter ?? "#";

  return {
    ...profile,
    mqttProtocolVersion: profile.mqttProtocolVersion ?? 4,
    subscriptionFilter:
      subscriptionFilter && subscriptionFilter.length > 0
        ? subscriptionFilter
        : primaryFilter,
    initialSubscriptions: normalizedInitialSubscriptions,
    overloadMode: profile.overloadMode ?? "balanced"
  };
}

function profileWithoutPersistedSecrets(
  profile: ConnectionProfile
): ConnectionProfile {
  return {
    ...normalizeProfile(profile),
    password: undefined,
    caCertPem: undefined,
    clientCertPem: undefined,
    clientKeyPem: undefined
  };
}

const previewDecoder = new TextDecoder();

function payloadPreview(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    return "<empty>";
  }

  const capped = bytes.byteLength > 256 ? bytes.slice(0, 256) : bytes;
  const text = previewDecoder.decode(capped).replace(/\s+/g, " ").trim();

  if (!text) {
    return `<${bytes.byteLength} bytes>`;
  }

  const withBounds = bytes.byteLength > 256 ? `${text}...` : text;
  return withBounds.length > 120 ? `${withBounds.slice(0, 120)}...` : withBounds;
}

function createRoot(): TopicTreeNode {
  return {
    name: "",
    fullPath: "",
    children: new Map<string, TopicTreeNode>(),
    isLeaf: false
  };
}

const initialProfile = defaultProfile();
const MESSAGE_HISTORY_LIMIT = 240;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      profiles: [initialProfile],
      activeProfileId: initialProfile.id,
      connectionState: "disconnected",
      connectionError: null,
      root: createRoot(),
      topics: new Map<string, TopicSnapshot>(),
      topicRevision: 0,
      selectedTopic: null,
      expandedPaths: new Set<string>(),
      searchTerm: "",
      historyEnabledTopics: new Set<string>(),
      historyByTopic: new Map<string, HistoryPoint[]>(),
      messageHistoryByTopic: new Map<string, TopicMessageRecord[]>(),
      messageSequence: 0,
      pendingNewTopics: [],
      pendingTopicCountDeltas: [],
      topicStatsRevision: 0,
      topicActivityMode: "subtle",

      setConnectionState: (state, error = null) => {
        set({ connectionState: state, connectionError: error });
      },

      setSearchTerm: (value) => {
        set({ searchTerm: value });
      },

      setSelectedTopic: (topic) => {
        set({ selectedTopic: topic });
      },

      toggleExpanded: (path) => {
        const copy = new Set(get().expandedPaths);
        if (copy.has(path)) {
          copy.delete(path);
        } else {
          copy.add(path);
        }
        set({ expandedPaths: copy });
      },

      upsertProfile: (profile) => {
        const profiles = [...get().profiles];
        const existing = profiles.findIndex((entry) => entry.id === profile.id);
        if (existing >= 0) {
          profiles[existing] = profile;
        } else {
          profiles.push(profile);
        }
        set({ profiles });
      },

      createProfile: () => {
        const profile: ConnectionProfile = {
          ...defaultProfile(),
          name: `Broker ${get().profiles.length + 1}`
        };

        set({
          profiles: [...get().profiles, profile],
          activeProfileId: profile.id
        });
      },

      removeActiveProfile: () => {
        const activeId = get().activeProfileId;
        if (!activeId) {
          return;
        }

        void getElectronBridge()?.deleteSecrets(activeId).catch((error) => {
          console.error("Failed to remove stored profile credentials", error);
        });

        const nextProfiles = get().profiles.filter(
          (profile) => profile.id !== activeId
        );

        if (nextProfiles.length === 0) {
          const replacement = defaultProfile();
          set({ profiles: [replacement], activeProfileId: replacement.id });
          return;
        }

        set({ profiles: nextProfiles, activeProfileId: nextProfiles[0]?.id ?? null });
      },

      clearProfileSecrets: (profileIds) => {
        const ids = new Set(profileIds);
        if (ids.size === 0) {
          return;
        }
        set({
          profiles: get().profiles.map((profile) =>
            ids.has(profile.id) ? profileWithoutPersistedSecrets(profile) : profile
          )
        });
      },

      setActiveProfile: (id) => {
        set({ activeProfileId: id });
      },

      updateActiveProfile: (patch) => {
        const activeId = get().activeProfileId;
        if (!activeId) {
          return;
        }

        set({
          profiles: get().profiles.map((profile) =>
            profile.id === activeId
              ? normalizeProfile({ ...profile, ...patch })
              : profile
          )
        });
      },

      ingestMessages: (messages) => {
        if (messages.length === 0) {
          return;
        }

        const topics = new Map(get().topics);
        const historyByTopic = new Map(get().historyByTopic);
        const messageHistoryByTopic = new Map(get().messageHistoryByTopic);
        const enabledHistory = get().historyEnabledTopics;
        const newTopics: string[] = [];
        const deltaByTopic = new Map<string, number>();
        let messageSequence = get().messageSequence;

        for (const message of messages) {
          const existingSnapshot = topics.get(message.topic);
          const alreadySeen = Boolean(existingSnapshot);

          topics.set(message.topic, {
            topic: message.topic,
            payload: message.payload,
            qos: message.qos,
            retain: message.retain,
            timestamp: message.timestamp,
            mqtt5: message.mqtt5,
            preview: payloadPreview(message.payload),
            messageCount: (existingSnapshot?.messageCount ?? 0) + 1
          });

          if (!alreadySeen) {
            newTopics.push(message.topic);
          }
          deltaByTopic.set(message.topic, (deltaByTopic.get(message.topic) ?? 0) + 1);

          if (enabledHistory.has(message.topic)) {
            const nextRecord: TopicMessageRecord = {
              sequence: ++messageSequence,
              topic: message.topic,
              payload: new Uint8Array(message.payload),
              qos: message.qos,
              retain: message.retain,
              timestamp: message.timestamp,
              mqtt5: message.mqtt5
            };
            const currentHistory = messageHistoryByTopic.get(message.topic) ?? [];
            const nextHistory =
              currentHistory.length >= MESSAGE_HISTORY_LIMIT
                ? [
                    ...currentHistory.slice(
                      currentHistory.length - MESSAGE_HISTORY_LIMIT + 1
                    ),
                    nextRecord
                  ]
                : [...currentHistory, nextRecord];
            messageHistoryByTopic.set(message.topic, nextHistory);

            const numeric = tryExtractNumericValue(message.payload);
            if (numeric !== null) {
              let series = historyByTopic.get(message.topic);
              if (!series) {
                series = [];
                historyByTopic.set(message.topic, series);
              }
              series.push({ timestamp: message.timestamp, value: numeric });
              if (series.length > 5000) {
                series.splice(0, series.length - 5000);
              }
            }
          }
        }

        const topicCountDeltas: TopicCountDelta[] = Array.from(deltaByTopic.entries()).map(
          ([topic, deltaMessages]) => ({ topic, deltaMessages })
        );
        const previous = get();
        set({
          topics,
          historyByTopic,
          messageHistoryByTopic,
          messageSequence,
          pendingNewTopics:
            newTopics.length > 0
              ? [...previous.pendingNewTopics, ...newTopics]
              : previous.pendingNewTopics,
          pendingTopicCountDeltas:
            topicCountDeltas.length > 0
              ? [...previous.pendingTopicCountDeltas, ...topicCountDeltas]
              : previous.pendingTopicCountDeltas,
          topicRevision:
            newTopics.length > 0 ? previous.topicRevision + 1 : previous.topicRevision,
          topicStatsRevision:
            topicCountDeltas.length > 0
              ? previous.topicStatsRevision + 1
              : previous.topicStatsRevision
        });
      },

      drainPendingNewTopics: () => {
        const pending = get().pendingNewTopics;
        if (pending.length > 0) {
          set({ pendingNewTopics: [] });
        }
        return pending;
      },

      drainPendingTopicCountDeltas: () => {
        const pending = get().pendingTopicCountDeltas;
        if (pending.length > 0) {
          set({ pendingTopicCountDeltas: [] });
        }
        return pending;
      },

      clearRuntimeData: () => {
        set({
          connectionError: null,
          root: createRoot(),
          topics: new Map<string, TopicSnapshot>(),
          topicRevision: get().topicRevision + 1,
          topicStatsRevision: get().topicStatsRevision + 1,
          selectedTopic: null,
          historyByTopic: new Map<string, HistoryPoint[]>(),
          messageHistoryByTopic: new Map<string, TopicMessageRecord[]>(),
          messageSequence: 0,
          pendingNewTopics: [],
          pendingTopicCountDeltas: []
        });
      },

      toggleHistoryForTopic: (topic) => {
        const enabled = new Set(get().historyEnabledTopics);
        if (enabled.has(topic)) {
          enabled.delete(topic);
          const historyByTopic = new Map(get().historyByTopic);
          const messageHistoryByTopic = new Map(get().messageHistoryByTopic);
          historyByTopic.delete(topic);
          messageHistoryByTopic.delete(topic);
          set({
            historyEnabledTopics: enabled,
            historyByTopic,
            messageHistoryByTopic
          });
          return;
        } else {
          enabled.add(topic);
        }

        set({ historyEnabledTopics: enabled });
      },

      setTopicActivityMode: (mode) => {
        set({ topicActivityMode: mode });
      }
    }),
    {
      name: "mqtt-rover-store",
      partialize: (state): PersistedSlice => ({
        profiles: state.profiles.map(profileWithoutPersistedSecrets),
        activeProfileId: state.activeProfileId,
        expandedPaths: Array.from(state.expandedPaths),
        historyEnabledTopics: Array.from(state.historyEnabledTopics),
        topicActivityMode: state.topicActivityMode
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedSlice;
        const persistedProfiles = (persisted.profiles ?? []).map(normalizeProfile);
        return {
          ...currentState,
          ...persisted,
          profiles: persistedProfiles.length > 0 ? persistedProfiles : currentState.profiles,
          expandedPaths: new Set(persisted.expandedPaths ?? []),
          historyEnabledTopics: new Set(persisted.historyEnabledTopics ?? []),
          topicActivityMode:
            persisted.topicActivityMode === "off" ||
            persisted.topicActivityMode === "full"
              ? persisted.topicActivityMode
              : "subtle"
        } satisfies AppState;
      }
    }
  )
);

export function useActiveProfile(): ConnectionProfile | null {
  return useAppStore((state) =>
    state.profiles.find((profile) => profile.id === state.activeProfileId) ?? null
  );
}
