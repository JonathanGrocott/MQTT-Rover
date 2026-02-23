import mqtt, { IClientOptions, MqttClient } from "mqtt";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  bytesToHex,
  ConnectionProfile,
  MessageEnvelope,
  Mqtt5UserProperty,
  PublishRequest,
  SubscriptionRequest
} from "@mqtt-rover/protocol";
import { errorMessage } from "./errors";
import { resolveInitialSubscriptions } from "./subscriptions";

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
  mqtt5?: MessageEnvelope["mqtt5"];
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

function mqtt5UserPropertiesToMqttJs(
  properties?: Mqtt5UserProperty[]
): Record<string, string | string[]> | undefined {
  if (!properties || properties.length === 0) {
    return undefined;
  }

  const grouped = new Map<string, string[]>();
  for (const entry of properties) {
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    const values = grouped.get(key) ?? [];
    values.push(entry.value);
    grouped.set(key, values);
  }

  if (grouped.size === 0) {
    return undefined;
  }

  const userProperties: Record<string, string | string[]> = {};
  for (const [key, values] of grouped.entries()) {
    userProperties[key] = values.length === 1 ? values[0] ?? "" : values;
  }
  return userProperties;
}

function mqtt5UserPropertiesFromMqttJs(value: unknown): Mqtt5UserProperty[] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries: Mqtt5UserProperty[] = [];
  for (const [key, rawValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (Array.isArray(rawValue)) {
      for (const entry of rawValue) {
        if (typeof entry === "string") {
          entries.push({ key, value: entry });
        }
      }
      continue;
    }
    if (typeof rawValue === "string") {
      entries.push({ key, value: rawValue });
    }
  }
  return entries.length > 0 ? entries : undefined;
}

function mqtt5BinaryToDisplay(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return bytesToHex(value);
  }
  return undefined;
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
    const initialSubscriptions = resolveInitialSubscriptions(profile);

    const options: IClientOptions = {
      username: profile.username || undefined,
      password: profile.password || undefined,
      clientId: profile.clientId || undefined,
      clean: profile.clean ?? true,
      keepalive: profile.keepalive ?? 30,
      reconnectPeriod: profile.reconnectPeriodMs ?? 1000,
      connectTimeout: 10_000
    };

    if (profile.mqttProtocolVersion === 5) {
      options.protocolVersion = 5;
      const connectProperties = profile.mqtt5ConnectProperties;
      if (connectProperties) {
        options.properties = {
          sessionExpiryInterval: connectProperties.sessionExpiryInterval,
          receiveMaximum: connectProperties.receiveMaximum,
          topicAliasMaximum: connectProperties.topicAliasMaximum,
          requestResponseInformation:
            connectProperties.requestResponseInformation,
          requestProblemInformation:
            connectProperties.requestProblemInformation,
          userProperties: mqtt5UserPropertiesToMqttJs(
            connectProperties.userProperties
          )
        };
      }
    }

    const client = mqtt.connect(toUrl(profile), options);
    this.webClient = client;

    client.on("connect", () => {
      handlers.onState("connected");
      for (const subscription of initialSubscriptions) {
        const subscribeOptions: Record<string, unknown> = {
          qos: subscription.qos
        };
        if (subscription.mqtt5) {
          subscribeOptions.nl = subscription.mqtt5.noLocal;
          subscribeOptions.rap = subscription.mqtt5.retainAsPublished;
          subscribeOptions.rh = subscription.mqtt5.retainHandling;
          if (
            subscription.mqtt5.subscriptionIdentifier !== undefined ||
            (subscription.mqtt5.userProperties?.length ?? 0) > 0
          ) {
            subscribeOptions.properties = {
              subscriptionIdentifier: subscription.mqtt5.subscriptionIdentifier,
              userProperties: mqtt5UserPropertiesToMqttJs(
                subscription.mqtt5.userProperties
              )
            };
          }
        }

        client.subscribe(
          subscription.topicFilter,
          subscribeOptions as never,
          (error) => {
            if (error) {
              handlers.onError(`Subscribe failed: ${error.message}`);
            }
          }
        );
      }
    });

    client.on("message", (topic, payload, packet) => {
      const packetProperties = (packet.properties ??
        {}) as Record<string, unknown>;
      const rawSubscriptionIdentifier = packetProperties.subscriptionIdentifier;
      const subscriptionIdentifier = Array.isArray(rawSubscriptionIdentifier)
        ? rawSubscriptionIdentifier
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value))
        : typeof rawSubscriptionIdentifier === "number"
          ? [rawSubscriptionIdentifier]
          : undefined;

      handlers.onMessage({
        topic,
        payload: new Uint8Array(payload),
        qos: (packet.qos as 0 | 1 | 2) ?? 0,
        retain: Boolean(packet.retain),
        timestamp: Date.now(),
        mqtt5:
          Object.keys(packetProperties).length > 0
            ? {
                payloadFormatIndicator:
                  typeof packetProperties.payloadFormatIndicator === "number"
                    ? packetProperties.payloadFormatIndicator
                    : undefined,
                messageExpiryInterval:
                  typeof packetProperties.messageExpiryInterval === "number"
                    ? packetProperties.messageExpiryInterval
                    : undefined,
                responseTopic:
                  typeof packetProperties.responseTopic === "string"
                    ? packetProperties.responseTopic
                    : undefined,
                correlationData: mqtt5BinaryToDisplay(
                  packetProperties.correlationData
                ),
                contentType:
                  typeof packetProperties.contentType === "string"
                    ? packetProperties.contentType
                    : undefined,
                subscriptionIdentifier,
                userProperties: mqtt5UserPropertiesFromMqttJs(
                  packetProperties.userProperties
                )
              }
            : undefined
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
          timestamp: payload.timestamp,
          mqtt5: payload.mqtt5
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
      throw new Error(errorMessage(error));
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
      const publishOptions: Record<string, unknown> = {
        qos: request.qos,
        retain: request.retain
      };
      if (request.mqtt5) {
        publishOptions.properties = {
          payloadFormatIndicator: request.mqtt5.payloadFormatIndicator,
          messageExpiryInterval: request.mqtt5.messageExpiryInterval,
          topicAlias: request.mqtt5.topicAlias,
          responseTopic: request.mqtt5.responseTopic,
          correlationData: request.mqtt5.correlationData,
          contentType: request.mqtt5.contentType,
          userProperties: mqtt5UserPropertiesToMqttJs(request.mqtt5.userProperties)
        };
      }

      this.webClient?.publish(
        request.topic,
        request.payload,
        publishOptions as never,
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

  async subscribe(request: SubscriptionRequest): Promise<void> {
    if (request.topicFilter.trim().length === 0) {
      throw new Error("Topic filter is required");
    }

    if (this.mode === "tauri") {
      await invoke("subscribe_tcp", { request });
      return;
    }

    if (!this.webClient) {
      throw new Error("No active MQTT client");
    }

    await new Promise<void>((resolve, reject) => {
      const subscribeOptions: Record<string, unknown> = { qos: request.qos };
      if (request.mqtt5) {
        subscribeOptions.nl = request.mqtt5.noLocal;
        subscribeOptions.rap = request.mqtt5.retainAsPublished;
        subscribeOptions.rh = request.mqtt5.retainHandling;
        if (
          request.mqtt5.subscriptionIdentifier !== undefined ||
          (request.mqtt5.userProperties?.length ?? 0) > 0
        ) {
          subscribeOptions.properties = {
            subscriptionIdentifier: request.mqtt5.subscriptionIdentifier,
            userProperties: mqtt5UserPropertiesToMqttJs(
              request.mqtt5.userProperties
            )
          };
        }
      }

      this.webClient?.subscribe(
        request.topicFilter,
        subscribeOptions as never,
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

  async unsubscribe(topicFilter: string): Promise<void> {
    if (topicFilter.trim().length === 0) {
      throw new Error("Topic filter is required");
    }

    if (this.mode === "tauri") {
      await invoke("unsubscribe_tcp", { topicFilter });
      return;
    }

    if (!this.webClient) {
      throw new Error("No active MQTT client");
    }

    await new Promise<void>((resolve, reject) => {
      this.webClient?.unsubscribe(topicFilter, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
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
