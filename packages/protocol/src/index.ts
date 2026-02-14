export type OverloadMode =
  | "balanced"
  | "latest-only"
  | "history-priority";

export interface ConnectionProfile {
  id: string;
  name: string;
  protocol: "ws" | "wss" | "mqtt" | "mqtts";
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
}

export interface PublishRequest {
  topic: string;
  payload: string;
  qos: 0 | 1 | 2;
  retain: boolean;
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
