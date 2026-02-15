export type OverloadMode =
  | "balanced"
  | "latest-only"
  | "history-priority";

export interface Mqtt5UserProperty {
  key: string;
  value: string;
}

export interface Mqtt5ConnectProperties {
  sessionExpiryInterval?: number;
  receiveMaximum?: number;
  topicAliasMaximum?: number;
  requestResponseInformation?: boolean;
  requestProblemInformation?: boolean;
  userProperties?: Mqtt5UserProperty[];
}

export interface Mqtt5PublishProperties {
  payloadFormatIndicator?: 0 | 1;
  messageExpiryInterval?: number;
  topicAlias?: number;
  responseTopic?: string;
  correlationData?: string;
  contentType?: string;
  userProperties?: Mqtt5UserProperty[];
}

export interface Mqtt5SubscribeProperties {
  noLocal?: boolean;
  retainAsPublished?: boolean;
  retainHandling?: 0 | 1 | 2;
  subscriptionIdentifier?: number;
  userProperties?: Mqtt5UserProperty[];
}

export interface Mqtt5IncomingProperties {
  payloadFormatIndicator?: number;
  messageExpiryInterval?: number;
  responseTopic?: string;
  correlationData?: string;
  contentType?: string;
  subscriptionIdentifier?: number[];
  userProperties?: Mqtt5UserProperty[];
}

export interface SubscriptionRequest {
  topicFilter: string;
  qos: 0 | 1 | 2;
  mqtt5?: Mqtt5SubscribeProperties;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  protocol: "ws" | "wss" | "mqtt" | "mqtts";
  mqttProtocolVersion?: 4 | 5;
  host: string;
  port: number;
  path?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clean?: boolean;
  keepalive?: number;
  reconnectPeriodMs?: number;
  subscriptionFilter?: string;
  initialSubscriptions?: SubscriptionRequest[];
  mqtt5ConnectProperties?: Mqtt5ConnectProperties;
  overloadMode?: OverloadMode;
  useMtls?: boolean;
  caCertPem?: string;
  clientCertPem?: string;
  clientKeyPem?: string;
}

export interface MessageEnvelope {
  topic: string;
  payload: Uint8Array;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
  mqtt5?: Mqtt5IncomingProperties;
}

export interface PublishRequest {
  topic: string;
  payload: string;
  qos: 0 | 1 | 2;
  retain: boolean;
  mqtt5?: Mqtt5PublishProperties;
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export const sparkplugTopicPattern = /^spBv1\.0\/[^/]+\/(NBIRTH|NDEATH|DBIRTH|DDEATH|NDATA|DDATA|NCMD|DCMD)\/.+/;

export function isSparkplugTopic(topic: string): boolean {
  return sparkplugTopicPattern.test(topic);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join(" ");
}

export function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function tryExtractNumericValue(bytes: Uint8Array): number | null {
  const text = bytesToUtf8(bytes).trim();
  if (!text) {
    return null;
  }

  const direct = Number(text);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const parsed = tryParseJson(text);
  if (typeof parsed === "number" && Number.isFinite(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === "object" && "value" in parsed) {
    const value = Number((parsed as Record<string, unknown>).value);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}
