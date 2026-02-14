import mqtt, { IClientOptions, MqttClient } from "mqtt";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  ConnectionProfile,
  MessageEnvelope,
  PublishRequest
} from "@mqtt-rover/protocol";

interface RuntimeHandlers {
  onMessage: (message: MessageEnvelope) => void;
  onState: (state: "connecting" | "connected" | "disconnected" | "error") => void;
  onError: (message: string) => void;
}

interface TauriIncomingMessage {
  topic: string;
  payload: number[];
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function shouldUseTcpTauri(profile: ConnectionProfile): boolean {
  return isTauriRuntime() && (profile.protocol === "mqtt" || profile.protocol === "mqtts");
}

function toUrl(profile: ConnectionProfile): string {
  const path = profile.path ?? "/mqtt";
  return `${profile.protocol}://${profile.host}:${profile.port}${path}`;
}

export class MqttRuntime {
  private webClient: MqttClient | null = null;
  private unlistenFns: UnlistenFn[] = [];
  private mode: "none" | "web" | "tauri" = "none";

  async connect(profile: ConnectionProfile, handlers: RuntimeHandlers): Promise<void> {
    await this.disconnect();
    handlers.onState("connecting");

    if (shouldUseTcpTauri(profile)) {
      this.mode = "tauri";
      await this.connectThroughTauri(profile, handlers);
      return;
    }

    this.mode = "web";
    this.connectThroughWebSocket(profile, handlers);
  }

  private connectThroughWebSocket(
    profile: ConnectionProfile,
    handlers: RuntimeHandlers
  ): void {
    const subscriptionFilter = profile.subscriptionFilter?.trim() || "#";

    const options: IClientOptions = {
      username: profile.username || undefined,
      password: profile.password || undefined,
      clientId: profile.clientId || undefined,
      clean: profile.clean ?? true,
      keepalive: profile.keepalive ?? 30,
      reconnectPeriod: profile.reconnectPeriodMs ?? 1000,
      connectTimeout: 10_000
    };

    const client = mqtt.connect(toUrl(profile), options);
    this.webClient = client;

    client.on("connect", () => {
      handlers.onState("connected");
      client.subscribe(subscriptionFilter, { qos: 0 }, (error) => {
        if (error) {
          handlers.onError(`Subscribe failed: ${error.message}`);
        }
      });
    });

    client.on("message", (topic, payload, packet) => {
      handlers.onMessage({
        topic,
        payload: new Uint8Array(payload),
        qos: (packet.qos as 0 | 1 | 2) ?? 0,
        retain: Boolean(packet.retain),
        timestamp: Date.now()
      });
    });

    client.on("error", (error) => {
      handlers.onState("error");
      handlers.onError(error.message);
    });

    client.on("close", () => {
      handlers.onState("disconnected");
    });
  }

  private async connectThroughTauri(
    profile: ConnectionProfile,
    handlers: RuntimeHandlers
  ): Promise<void> {
    const messageUnlisten = await listen<TauriIncomingMessage>(
      "mqtt://message",
      (event) => {
        const payload = event.payload;
        handlers.onMessage({
          topic: payload.topic,
          payload: new Uint8Array(payload.payload),
          qos: payload.qos,
          retain: payload.retain,
          timestamp: payload.timestamp
        });
      }
    );

    const statusUnlisten = await listen<string>("mqtt://status", (event) => {
      const status = event.payload;
      if (
        status === "connecting" ||
        status === "connected" ||
        status === "disconnected" ||
        status === "error"
      ) {
        handlers.onState(status);
      }
    });

    const errorUnlisten = await listen<string>("mqtt://error", (event) => {
      handlers.onState("error");
      handlers.onError(event.payload);
    });

    this.unlistenFns = [messageUnlisten, statusUnlisten, errorUnlisten];
    try {
      await invoke("connect_tcp", { profile });
    } catch (error) {
      for (const fn of this.unlistenFns) {
        await fn();
      }
      this.unlistenFns = [];
      throw error;
    }
  }

  async publish(request: PublishRequest): Promise<void> {
    if (this.mode === "tauri") {
      await invoke("publish_tcp", { request });
      return;
    }

    if (!this.webClient) {
      throw new Error("No active MQTT client");
    }

    await new Promise<void>((resolve, reject) => {
      this.webClient?.publish(
        request.topic,
        request.payload,
        { qos: request.qos, retain: request.retain },
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }
      );
    });
  }

  async disconnect(): Promise<void> {
    if (this.mode === "web" && this.webClient) {
      await new Promise<void>((resolve) => {
        this.webClient?.end(true, {}, () => resolve());
      });
      this.webClient = null;
    }

    if (this.mode === "tauri") {
      await invoke("disconnect_tcp").catch(() => undefined);
      for (const fn of this.unlistenFns) {
        await fn();
      }
      this.unlistenFns = [];
    }

    this.mode = "none";
  }
}

export const mqttRuntime = new MqttRuntime();
