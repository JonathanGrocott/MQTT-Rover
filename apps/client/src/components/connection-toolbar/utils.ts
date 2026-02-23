import { ConnectionProfile, Mqtt5UserProperty } from "@mqtt-rover/protocol";

export function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function toOperationErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Operation failed";
}

export function parseUserProperties(input: string): Mqtt5UserProperty[] | undefined {
  const entries = input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 0) {
        return null;
      }
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (!key) {
        return null;
      }
      return { key, value };
    })
    .filter((entry): entry is Mqtt5UserProperty => Boolean(entry));

  return entries.length > 0 ? entries : undefined;
}

export function serializeUserProperties(properties?: Mqtt5UserProperty[]): string {
  if (!properties || properties.length === 0) {
    return "";
  }
  return properties.map((entry) => `${entry.key}=${entry.value}`).join("\n");
}

export function hasWebSocketPath(profile: ConnectionProfile | null): boolean {
  return profile?.protocol === "ws" || profile?.protocol === "wss";
}
