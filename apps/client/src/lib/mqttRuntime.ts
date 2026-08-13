import mqtt, { IClientOptions, MqttClient } from "mqtt";
import {
  bytesToHex,
  ConnectionProfile,
  MessageEnvelope,
  Mqtt5UserProperty,
  PublishRequest,
  SubscriptionRequest
} from "@mqtt-rover/protocol";
import { resolveInitialSubscriptions } from "./subscriptions";
import { getElectronBridge } from "../desktop/electronBridge";

interface RuntimeHandlers {
  onMessage: (message: MessageEnvelope) => void;
  onState: (state: "connecting" | "connected" | "disconnected" | "error") => void;
  onError: (message: string) => void;
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
  private electronCleanupFns: Array<() => void> = [];
  private mode: "none" | "web" | "electron" = "none";

  async connect(profile: ConnectionProfile, handlers: RuntimeHandlers): Promise<void> {
    await this.disconnect();
    handlers.onState("connecting");

    if (getElectronBridge()) {
      this.mode = "electron";
      await this.connectThroughElectron(profile, handlers);
      return;
    }

    if (profile.protocol === "mqtt" || profile.protocol === "mqtts") {
      throw new Error("Raw MQTT connections require the desktop application");
    }

    this.mode = "web";
    this.connectThroughWebSocket(profile, handlers);
  }

  private async connectThroughElectron(
    profile: ConnectionProfile,
    handlers: RuntimeHandlers
  ): Promise<void> {
    const bridge = getElectronBridge();
    if (!bridge) {
      throw new Error("Electron desktop bridge is unavailable");
    }

    this.electronCleanupFns = [
      bridge.onMessageBatch((messages) => {
        for (const message of messages) {
          handlers.onMessage({
            ...message,
            payload: new Uint8Array(message.payload)
          });
        }
      }),
      bridge.onStatus(handlers.onState),
      bridge.onError((message) => {
        handlers.onState("error");
        handlers.onError(message);
      })
    ];

    try {
      await bridge.connect(profile);
    } catch (error) {
      this.clearElectronListeners();
      throw error;
    }
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

  async publish(request: PublishRequest): Promise<void> {
    if (this.mode === "electron") {
      const bridge = getElectronBridge();
      if (!bridge) throw new Error("Electron desktop bridge is unavailable");
      await bridge.publish(request);
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

    if (this.mode === "electron") {
      const bridge = getElectronBridge();
      if (!bridge) throw new Error("Electron desktop bridge is unavailable");
      await bridge.subscribe(request);
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

    if (this.mode === "electron") {
      const bridge = getElectronBridge();
      if (!bridge) throw new Error("Electron desktop bridge is unavailable");
      await bridge.unsubscribe(topicFilter);
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

    if (this.mode === "electron") {
      await getElectronBridge()?.disconnect().catch(() => undefined);
      this.clearElectronListeners();
    }

    this.mode = "none";
  }

  private clearElectronListeners(): void {
    for (const cleanup of this.electronCleanupFns) {
      cleanup();
    }
    this.electronCleanupFns = [];
  }
}

export const mqttRuntime = new MqttRuntime();
