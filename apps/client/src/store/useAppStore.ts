import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ConnectionProfile,
  ConnectionState,
  MessageEnvelope,
  tryExtractNumericValue
} from "@mqtt-rover/protocol";

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
  preview: string;
  messageCount: number;
}

export interface HistoryPoint {
  timestamp: number;
  value: number;
}

interface PersistedSlice {
  profiles: ConnectionProfile[];
  activeProfileId: string | null;
  expandedPaths: string[];
  historyEnabledTopics: string[];
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
  pendingNewTopics: string[];
  setConnectionState: (state: ConnectionState, error?: string | null) => void;
  setSearchTerm: (value: string) => void;
  setSelectedTopic: (topic: string | null) => void;
  toggleExpanded: (path: string) => void;
  upsertProfile: (profile: ConnectionProfile) => void;
  createProfile: () => void;
  removeActiveProfile: () => void;
  setActiveProfile: (id: string) => void;
  updateActiveProfile: (patch: Partial<ConnectionProfile>) => void;
  ingestMessages: (messages: MessageEnvelope[]) => void;
  drainPendingNewTopics: () => string[];
  clearRuntimeData: () => void;
  toggleHistoryForTopic: (topic: string) => void;
}

const defaultProfile = (): ConnectionProfile => ({
  id: createId(),
  name: "Local Mosquitto",
  protocol: "ws",
  host: "localhost",
  port: 9001,
  path: "/mqtt",
  clean: true,
  keepalive: 30,
  reconnectPeriodMs: 1000,
  subscriptionFilter: "#",
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
  const subscriptionFilter = profile.subscriptionFilter?.trim();
  return {
    ...profile,
    subscriptionFilter: subscriptionFilter && subscriptionFilter.length > 0 ? subscriptionFilter : "#",
    overloadMode: profile.overloadMode ?? "balanced"
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
      pendingNewTopics: [],

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
        const enabledHistory = get().historyEnabledTopics;
        const newTopics: string[] = [];

        for (const message of messages) {
          const existingSnapshot = topics.get(message.topic);
          const alreadySeen = Boolean(existingSnapshot);

          topics.set(message.topic, {
            topic: message.topic,
            payload: message.payload,
            qos: message.qos,
            retain: message.retain,
            timestamp: message.timestamp,
            preview: payloadPreview(message.payload),
            messageCount: (existingSnapshot?.messageCount ?? 0) + 1
          });

          if (!alreadySeen) {
            newTopics.push(message.topic);
          }

          if (enabledHistory.has(message.topic)) {
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

        const previous = get();
        set({
          topics,
          historyByTopic,
          pendingNewTopics:
            newTopics.length > 0
              ? [...previous.pendingNewTopics, ...newTopics]
              : previous.pendingNewTopics,
          topicRevision:
            newTopics.length > 0 ? previous.topicRevision + 1 : previous.topicRevision
        });
      },

      drainPendingNewTopics: () => {
        const pending = get().pendingNewTopics;
        if (pending.length > 0) {
          set({ pendingNewTopics: [] });
        }
        return pending;
      },

      clearRuntimeData: () => {
        set({
          connectionError: null,
          root: createRoot(),
          topics: new Map<string, TopicSnapshot>(),
          topicRevision: get().topicRevision + 1,
          selectedTopic: null,
          historyByTopic: new Map<string, HistoryPoint[]>(),
          pendingNewTopics: []
        });
      },

      toggleHistoryForTopic: (topic) => {
        const enabled = new Set(get().historyEnabledTopics);
        if (enabled.has(topic)) {
          enabled.delete(topic);
        } else {
          enabled.add(topic);
        }

        set({ historyEnabledTopics: enabled });
      }
    }),
    {
      name: "mqtt-rover-store",
      partialize: (state): PersistedSlice => ({
        profiles: state.profiles.map(normalizeProfile),
        activeProfileId: state.activeProfileId,
        expandedPaths: Array.from(state.expandedPaths),
        historyEnabledTopics: Array.from(state.historyEnabledTopics)
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedSlice;
        const persistedProfiles = (persisted.profiles ?? []).map(normalizeProfile);
        return {
          ...currentState,
          ...persisted,
          profiles: persistedProfiles.length > 0 ? persistedProfiles : currentState.profiles,
          expandedPaths: new Set(persisted.expandedPaths ?? []),
          historyEnabledTopics: new Set(persisted.historyEnabledTopics ?? [])
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
