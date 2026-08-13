import mqtt, { IClientOptions, MqttClient } from "mqtt";
import {
  bytesToHex,
  ConnectionProfile,
  ConnectionState,
  MessageEnvelope,
  Mqtt5UserProperty,
  PublishRequest,
  SubscriptionRequest
} from "@mqtt-rover/protocol";
import { resolveInitialSubscriptions } from "../src/lib/subscriptions";

interface SessionEvents {
  onMessages(messages: MessageEnvelope[]): void;
  onStatus(state: ConnectionState): void;
  onError(message: string): void;
}

const MESSAGE_BATCH_INTERVAL_MS = 16;
const MAX_PENDING_MESSAGES = 50_000;

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function profileUrl(profile: ConnectionProfile): string {
  const path = profile.protocol === "ws" || profile.protocol === "wss"
    ? profile.path ?? "/mqtt"
    : "";
  return `${profile.protocol}://${profile.host}:${profile.port}${path}`;
}

function userPropertiesToMqttJs(
  properties?: Mqtt5UserProperty[]
): Record<string, string | string[]> | undefined {
  if (!properties?.length) {
    return undefined;
  }

  const grouped = new Map<string, string[]>();
  for (const entry of properties) {
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), entry.value]);
  }

  if (grouped.size === 0) {
    return undefined;
  }

  return Object.fromEntries(
    Array.from(grouped.entries()).map(([key, values]) => [
      key,
      values.length === 1 ? values[0] ?? "" : values
    ])
  );
}

function userPropertiesFromMqttJs(value: unknown): Mqtt5UserProperty[] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries: Mqtt5UserProperty[] = [];
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const entry of values) {
      if (typeof entry === "string") {
        entries.push({ key, value: entry });
      }
    }
  }
  return entries.length > 0 ? entries : undefined;
}

function binaryPropertyToDisplay(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return bytesToHex(value);
  }
  return undefined;
}

function subscribeOptions(request: SubscriptionRequest): Record<string, unknown> {
  const options: Record<string, unknown> = { qos: request.qos };
  if (request.mqtt5) {
    options.nl = request.mqtt5.noLocal;
    options.rap = request.mqtt5.retainAsPublished;
    options.rh = request.mqtt5.retainHandling;
    if (
      request.mqtt5.subscriptionIdentifier !== undefined ||
      request.mqtt5.userProperties?.length
    ) {
      options.properties = {
        subscriptionIdentifier: request.mqtt5.subscriptionIdentifier,
        userProperties: userPropertiesToMqttJs(request.mqtt5.userProperties)
      };
    }
  }
  return options;
}

export class MqttSessionManager {
  private client: MqttClient | null = null;
  private pendingMessages: MessageEnvelope[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private generation = 0;

  constructor(private readonly events: SessionEvents) {}

  async connect(profile: ConnectionProfile): Promise<void> {
    await this.disconnect(false);
    this.events.onStatus("connecting");
    const generation = ++this.generation;

    const options: IClientOptions = {
      username: nonEmpty(profile.username),
      password: profile.password || undefined,
      clientId: nonEmpty(profile.clientId),
      clean: profile.clean ?? true,
      keepalive: profile.keepalive ?? 30,
      reconnectPeriod: profile.reconnectPeriodMs ?? 1_000,
      connectTimeout: 10_000,
      protocolVersion: profile.mqttProtocolVersion ?? 4,
      rejectUnauthorized: true
    };

    if (profile.mqttProtocolVersion === 5 && profile.mqtt5ConnectProperties) {
      const properties = profile.mqtt5ConnectProperties;
      options.properties = {
        sessionExpiryInterval: properties.sessionExpiryInterval,
        receiveMaximum: properties.receiveMaximum,
        topicAliasMaximum: properties.topicAliasMaximum,
        requestResponseInformation: properties.requestResponseInformation,
        requestProblemInformation: properties.requestProblemInformation,
        userProperties: userPropertiesToMqttJs(properties.userProperties)
      };
    }

    if (profile.protocol === "mqtts" || profile.protocol === "wss") {
      options.ca = nonEmpty(profile.caCertPem);
      options.cert = nonEmpty(profile.clientCertPem);
      options.key = nonEmpty(profile.clientKeyPem);
    }

    const client = mqtt.connect(profileUrl(profile), options);
    this.client = client;

    client.on("connect", () => {
      if (generation !== this.generation) {
        return;
      }
      this.events.onStatus("connected");
      for (const subscription of resolveInitialSubscriptions(profile)) {
        client.subscribe(
          subscription.topicFilter,
          subscribeOptions(subscription) as never,
          (error) => {
            if (error) {
              this.events.onError(`Subscribe failed: ${error.message}`);
            }
          }
        );
      }
    });

    client.on("message", (topic, payload, packet) => {
      if (generation !== this.generation) {
        return;
      }
      const properties = (packet.properties ?? {}) as Record<string, unknown>;
      const rawSubscriptionId = properties.subscriptionIdentifier;
      const subscriptionIdentifier = Array.isArray(rawSubscriptionId)
        ? rawSubscriptionId.map(Number).filter(Number.isFinite)
        : typeof rawSubscriptionId === "number"
          ? [rawSubscriptionId]
          : undefined;

      this.enqueueMessage({
        topic,
        payload: new Uint8Array(payload),
        qos: (packet.qos as 0 | 1 | 2) ?? 0,
        retain: Boolean(packet.retain),
        timestamp: Date.now(),
        mqtt5: Object.keys(properties).length > 0
          ? {
              payloadFormatIndicator:
                typeof properties.payloadFormatIndicator === "number"
                  ? properties.payloadFormatIndicator
                  : undefined,
              messageExpiryInterval:
                typeof properties.messageExpiryInterval === "number"
                  ? properties.messageExpiryInterval
                  : undefined,
              responseTopic:
                typeof properties.responseTopic === "string"
                  ? properties.responseTopic
                  : undefined,
              correlationData: binaryPropertyToDisplay(properties.correlationData),
              contentType:
                typeof properties.contentType === "string"
                  ? properties.contentType
                  : undefined,
              subscriptionIdentifier,
              userProperties: userPropertiesFromMqttJs(properties.userProperties)
            }
          : undefined
      });
    });

    client.on("error", (error) => {
      if (generation !== this.generation) {
        return;
      }
      this.events.onStatus("error");
      this.events.onError(error.message);
    });

    client.on("close", () => {
      if (generation === this.generation) {
        this.events.onStatus("disconnected");
      }
    });
  }

  async publish(request: PublishRequest): Promise<void> {
    const client = this.requireClient();
    const options: Record<string, unknown> = {
      qos: request.qos,
      retain: request.retain
    };
    if (request.mqtt5) {
      options.properties = {
        payloadFormatIndicator: request.mqtt5.payloadFormatIndicator,
        messageExpiryInterval: request.mqtt5.messageExpiryInterval,
        topicAlias: request.mqtt5.topicAlias,
        responseTopic: request.mqtt5.responseTopic,
        correlationData: request.mqtt5.correlationData,
        contentType: request.mqtt5.contentType,
        userProperties: userPropertiesToMqttJs(request.mqtt5.userProperties)
      };
    }

    await new Promise<void>((resolve, reject) => {
      client.publish(request.topic, request.payload, options as never, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async subscribe(request: SubscriptionRequest): Promise<void> {
    if (!request.topicFilter.trim()) {
      throw new Error("Topic filter is required");
    }
    const client = this.requireClient();
    await new Promise<void>((resolve, reject) => {
      client.subscribe(request.topicFilter, subscribeOptions(request) as never, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async unsubscribe(topicFilter: string): Promise<void> {
    if (!topicFilter.trim()) {
      throw new Error("Topic filter is required");
    }
    const client = this.requireClient();
    await new Promise<void>((resolve, reject) => {
      client.unsubscribe(topicFilter, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async disconnect(emitStatus = true): Promise<void> {
    this.generation += 1;
    this.clearPendingMessages();
    const client = this.client;
    this.client = null;
    if (client) {
      await new Promise<void>((resolve, reject) => {
        client.end(true, {}, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    if (emitStatus) {
      this.events.onStatus("disconnected");
    }
  }

  private requireClient(): MqttClient {
    if (!this.client) {
      throw new Error("No active MQTT client");
    }
    return this.client;
  }

  private enqueueMessage(message: MessageEnvelope): void {
    if (this.pendingMessages.length >= MAX_PENDING_MESSAGES) {
      this.pendingMessages.shift();
    }
    this.pendingMessages.push(message);
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flushMessages(), MESSAGE_BATCH_INTERVAL_MS);
    }
  }

  private flushMessages(): void {
    this.batchTimer = null;
    if (this.pendingMessages.length === 0) {
      return;
    }
    const batch = this.pendingMessages;
    this.pendingMessages = [];
    this.events.onMessages(batch);
  }

  private clearPendingMessages(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingMessages = [];
  }
}
