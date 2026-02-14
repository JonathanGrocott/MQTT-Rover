import protobuf from "protobufjs";

export interface SparkplugMetric {
  name?: string;
  alias?: number;
  datatype?: number;
  timestamp?: number;
  value: number | string | boolean | null;
}

export interface SparkplugDecodeResult {
  timestamp?: string;
  seq?: string;
  bdSeq?: string;
  metrics: SparkplugMetric[];
}

const proto = String.raw`
syntax = "proto2";

message Payload {
  optional uint64 timestamp = 1;
  optional uint64 seq = 2;
  repeated Metric metrics = 3;
  optional uint64 uuid = 4;
  optional bytes body = 5;
  optional uint64 bdSeq = 6;
}

message Metric {
  optional string name = 1;
  optional uint64 alias = 2;
  optional uint64 timestamp = 3;
  optional uint32 datatype = 4;
  optional bool is_null = 5;

  oneof value {
    uint32 int_value = 10;
    uint64 long_value = 11;
    float float_value = 12;
    double double_value = 13;
    bool boolean_value = 14;
    string string_value = 15;
    bytes bytes_value = 16;
  }
}
`;

const root = protobuf.parse(proto).root;
const payloadType = root.lookupType("Payload");

function normalizeValue(metric: Record<string, unknown>): number | string | boolean | null {
  if (metric.is_null) {
    return null;
  }
  if (typeof metric.int_value === "number") {
    return metric.int_value;
  }
  if (typeof metric.long_value === "string") {
    return Number(metric.long_value);
  }
  if (typeof metric.long_value === "number") {
    return metric.long_value;
  }
  if (typeof metric.float_value === "number") {
    return metric.float_value;
  }
  if (typeof metric.double_value === "number") {
    return metric.double_value;
  }
  if (typeof metric.boolean_value === "boolean") {
    return metric.boolean_value;
  }
  if (typeof metric.string_value === "string") {
    return metric.string_value;
  }
  if (metric.bytes_value instanceof Uint8Array) {
    return `[bytes:${metric.bytes_value.byteLength}]`;
  }
  return null;
}

function maybeU64(value: unknown): string | undefined {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

export function decodeSparkplugPayload(payload: Uint8Array): SparkplugDecodeResult | null {
  try {
    const decoded = payloadType.decode(payload);
    const object = payloadType.toObject(decoded, {
      longs: String,
      defaults: false,
      oneofs: true
    }) as Record<string, unknown>;

    const rawMetrics = Array.isArray(object.metrics) ? object.metrics : [];
    const metrics = rawMetrics.map((entry) => {
      const metric = entry as Record<string, unknown>;
      return {
        name: typeof metric.name === "string" ? metric.name : undefined,
        alias:
          typeof metric.alias === "number"
            ? metric.alias
            : typeof metric.alias === "string"
              ? Number(metric.alias)
              : undefined,
        datatype:
          typeof metric.datatype === "number" ? metric.datatype : undefined,
        timestamp: maybeU64(metric.timestamp)
          ? Number(maybeU64(metric.timestamp))
          : undefined,
        value: normalizeValue(metric)
      };
    });

    return {
      timestamp: maybeU64(object.timestamp),
      seq: maybeU64(object.seq),
      bdSeq: maybeU64(object.bdSeq),
      metrics
    };
  } catch {
    return null;
  }
}
