import {
  ConnectionProfile,
  ConnectionState,
  MessageEnvelope,
  PublishRequest,
  SubscriptionRequest
} from "@mqtt-rover/protocol";

export const ELECTRON_IPC = {
  connect: "mqtt-rover:mqtt:connect",
  disconnect: "mqtt-rover:mqtt:disconnect",
  publish: "mqtt-rover:mqtt:publish",
  subscribe: "mqtt-rover:mqtt:subscribe",
  unsubscribe: "mqtt-rover:mqtt:unsubscribe",
  migrateSecrets: "mqtt-rover:credentials:migrate",
  deleteSecrets: "mqtt-rover:credentials:delete",
  messageBatch: "mqtt-rover:mqtt:message-batch",
  status: "mqtt-rover:mqtt:status",
  error: "mqtt-rover:mqtt:error"
} as const;

export interface ElectronMqttBridge {
  connect(profile: ConnectionProfile): Promise<void>;
  disconnect(): Promise<void>;
  publish(request: PublishRequest): Promise<void>;
  subscribe(request: SubscriptionRequest): Promise<void>;
  unsubscribe(topicFilter: string): Promise<void>;
  migrateSecrets(profiles: ConnectionProfile[]): Promise<string[]>;
  deleteSecrets(profileId: string): Promise<void>;
  onMessageBatch(listener: (messages: MessageEnvelope[]) => void): () => void;
  onStatus(listener: (state: ConnectionState) => void): () => void;
  onError(listener: (message: string) => void): () => void;
}

declare global {
  interface Window {
    mqttRoverDesktop?: ElectronMqttBridge;
  }
}

export function getElectronBridge(): ElectronMqttBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.mqttRoverDesktop ?? null;
}
