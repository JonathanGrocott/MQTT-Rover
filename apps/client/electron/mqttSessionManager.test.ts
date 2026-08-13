import { EventEmitter } from "node:events";
import mqtt from "mqtt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProfile } from "@mqtt-rover/protocol";
import { MqttSessionManager } from "./mqttSessionManager";

vi.mock("mqtt", () => ({
  default: { connect: vi.fn() }
}));

class FakeMqttClient extends EventEmitter {
  subscribe = vi.fn(
    (_topic: string, _options: unknown, callback: (error?: Error) => void) =>
      callback()
  );
  publish = vi.fn(
    (
      _topic: string,
      _payload: string,
      _options: unknown,
      callback: (error?: Error) => void
    ) => callback()
  );
  unsubscribe = vi.fn(
    (_topic: string, callback: (error?: Error) => void) => callback()
  );
  end = vi.fn(
    (_force: boolean, _options: unknown, callback: (error?: Error) => void) =>
      callback()
  );
}

const profile: ConnectionProfile = {
  id: "profile-1",
  name: "Local TLS",
  protocol: "mqtts",
  mqttProtocolVersion: 5,
  host: "broker.internal",
  port: 8883,
  clean: true,
  keepalive: 30,
  reconnectPeriodMs: 1_000,
  username: "operator",
  password: "secret",
  caCertPem: "ca-pem",
  clientCertPem: "cert-pem",
  clientKeyPem: "key-pem",
  initialSubscriptions: [{ topicFilter: "factory/#", qos: 1 }]
};

describe("MqttSessionManager", () => {
  let client: FakeMqttClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new FakeMqttClient();
    vi.mocked(mqtt.connect).mockReturnValue(client as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("connects with desktop TLS options and applies initial subscriptions", async () => {
    const onStatus = vi.fn();
    const manager = new MqttSessionManager({
      onMessages: vi.fn(),
      onStatus,
      onError: vi.fn()
    });

    await manager.connect(profile);

    expect(mqtt.connect).toHaveBeenCalledWith(
      "mqtts://broker.internal:8883",
      expect.objectContaining({
        protocolVersion: 5,
        username: "operator",
        password: "secret",
        ca: "ca-pem",
        cert: "cert-pem",
        key: "key-pem",
        rejectUnauthorized: true
      })
    );
    expect(onStatus).toHaveBeenCalledWith("connecting");

    client.emit("connect");
    expect(onStatus).toHaveBeenCalledWith("connected");
    expect(client.subscribe).toHaveBeenCalledWith(
      "factory/#",
      expect.objectContaining({ qos: 1 }),
      expect.any(Function)
    );
  });

  it("batches incoming messages before sending them to the renderer", async () => {
    const onMessages = vi.fn();
    const manager = new MqttSessionManager({
      onMessages,
      onStatus: vi.fn(),
      onError: vi.fn()
    });
    await manager.connect(profile);

    client.emit("message", "factory/line/temperature", Buffer.from("21.5"), {
      qos: 1,
      retain: false,
      properties: { contentType: "text/plain" }
    });
    client.emit("message", "factory/line/pressure", Buffer.from("102"), {
      qos: 0,
      retain: true,
      properties: {}
    });

    expect(onMessages).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);

    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(onMessages.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        topic: "factory/line/temperature",
        qos: 1,
        mqtt5: expect.objectContaining({ contentType: "text/plain" })
      }),
      expect.objectContaining({
        topic: "factory/line/pressure",
        qos: 0,
        retain: true
      })
    ]);
  });

  it("reports connection failures without oscillating the status", async () => {
    const onStatus = vi.fn();
    const onError = vi.fn();
    const manager = new MqttSessionManager({
      onMessages: vi.fn(),
      onStatus,
      onError
    });
    await manager.connect(profile);

    client.emit("error", new Error("connection refused"));
    client.emit("close");

    expect(onError).toHaveBeenCalledWith("connection refused");
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      "connecting",
      "disconnected"
    ]);
  });
});
