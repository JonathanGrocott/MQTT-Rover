import { ConnectionProfile } from "@mqtt-rover/protocol";
import { useAppStore } from "../store/useAppStore";
import { getElectronBridge } from "./electronBridge";

const SECRET_FIELDS = [
  "password",
  "caCertPem",
  "clientCertPem",
  "clientKeyPem"
] as const satisfies ReadonlyArray<keyof ConnectionProfile>;

export function profileHasLegacySecrets(profile: ConnectionProfile): boolean {
  return SECRET_FIELDS.some((field) => {
    const value = profile[field];
    return typeof value === "string" && value.length > 0;
  });
}

export async function migrateLegacyProfileSecrets(): Promise<void> {
  const state = useAppStore.getState();
  const legacyProfiles = state.profiles.filter(profileHasLegacySecrets);
  if (legacyProfiles.length === 0) {
    return;
  }

  const bridge = getElectronBridge();
  const profileIds = bridge
    ? await bridge.migrateSecrets(legacyProfiles)
    : legacyProfiles.map((profile) => profile.id);

  useAppStore.getState().clearProfileSecrets(profileIds);
}
