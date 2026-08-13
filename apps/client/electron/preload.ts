import { contextBridge, ipcRenderer } from "electron";
import {
  ConnectionProfile,
  ConnectionState,
  MessageEnvelope,
  PublishRequest,
  SubscriptionRequest
} from "@mqtt-rover/protocol";
import {
  ELECTRON_IPC,
  ElectronMqttBridge
} from "../src/desktop/electronBridge";

function subscribeToEvent<T>(
  channel: string,
  listener: (payload: T) => void
): () => void {
  const wrappedListener = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload);
  };
  ipcRenderer.on(channel, wrappedListener);
  return () => ipcRenderer.removeListener(channel, wrappedListener);
}

const bridge: ElectronMqttBridge = {
  connect: (profile: ConnectionProfile) =>
    ipcRenderer.invoke(ELECTRON_IPC.connect, profile),
  disconnect: () => ipcRenderer.invoke(ELECTRON_IPC.disconnect),
  publish: (request: PublishRequest) =>
    ipcRenderer.invoke(ELECTRON_IPC.publish, request),
  subscribe: (request: SubscriptionRequest) =>
    ipcRenderer.invoke(ELECTRON_IPC.subscribe, request),
  unsubscribe: (topicFilter: string) =>
    ipcRenderer.invoke(ELECTRON_IPC.unsubscribe, topicFilter),
  onMessageBatch: (listener: (messages: MessageEnvelope[]) => void) =>
    subscribeToEvent(ELECTRON_IPC.messageBatch, listener),
  onStatus: (listener: (state: ConnectionState) => void) =>
    subscribeToEvent(ELECTRON_IPC.status, listener),
  onError: (listener: (message: string) => void) =>
    subscribeToEvent(ELECTRON_IPC.error, listener)
};

contextBridge.exposeInMainWorld("mqttRoverDesktop", bridge);
