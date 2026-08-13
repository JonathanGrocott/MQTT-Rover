import { describe, expect, it } from "vitest";
import { ConnectionProfile } from "@mqtt-rover/protocol";
import { profileHasLegacySecrets } from "./credentialMigration";

const profile: ConnectionProfile = {
  id: "profile-1",
  name: "Broker",
  protocol: "mqtt",
  host: "localhost",
  port: 1883
};

describe("profileHasLegacySecrets", () => {
  it("recognizes credentials from older persisted profiles", () => {
    expect(profileHasLegacySecrets({ ...profile, password: "secret" })).toBe(true);
    expect(profileHasLegacySecrets({ ...profile, clientKeyPem: "private-key" })).toBe(
      true
    );
  });

  it("ignores profiles without sensitive values", () => {
    expect(profileHasLegacySecrets(profile)).toBe(false);
    expect(profileHasLegacySecrets({ ...profile, password: "" })).toBe(false);
  });
});
