import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConnectionProfile } from "@mqtt-rover/protocol";

interface StoredSecrets {
  password?: string;
  caCertPem?: string;
  clientCertPem?: string;
  clientKeyPem?: string;
}

type EncryptedSecretFile = Record<string, string>;

const SECRET_FIELDS = [
  "password",
  "caCertPem",
  "clientCertPem",
  "clientKeyPem"
] as const satisfies ReadonlyArray<keyof StoredSecrets>;

export class CredentialStore {
  private readonly filePath = path.join(app.getPath("userData"), "secrets.json");
  private writeChain: Promise<void> = Promise.resolve();

  async hydrateAndStore(profile: ConnectionProfile): Promise<ConnectionProfile> {
    const stored = await this.readProfileSecrets(profile.id);
    const supplied = this.secretsFromProfile(profile);

    if (Object.keys(supplied).length > 0) {
      await this.writeProfileSecrets(profile.id, { ...stored, ...supplied });
    }

    return {
      ...profile,
      ...stored,
      ...supplied
    };
  }

  async migrateProfiles(profiles: ConnectionProfile[]): Promise<string[]> {
    const migratedProfileIds: string[] = [];
    for (const profile of profiles) {
      const supplied = this.secretsFromProfile(profile);
      if (Object.keys(supplied).length === 0) {
        continue;
      }
      const stored = await this.readProfileSecrets(profile.id);
      await this.writeProfileSecrets(profile.id, { ...stored, ...supplied });
      migratedProfileIds.push(profile.id);
    }
    return migratedProfileIds;
  }

  async deleteProfile(profileId: string): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const allSecrets = await this.readEncryptedFile();
      if (!(profileId in allSecrets)) {
        return;
      }
      delete allSecrets[profileId];
      if (Object.keys(allSecrets).length === 0) {
        await unlink(this.filePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        return;
      }
      await this.writeEncryptedFile(allSecrets);
    });
    await this.writeChain;
  }

  private secretsFromProfile(profile: ConnectionProfile): StoredSecrets {
    const supplied: StoredSecrets = {};
    for (const field of SECRET_FIELDS) {
      const value = profile[field];
      if (typeof value === "string" && value.length > 0) {
        supplied[field] = value;
      }
    }
    return supplied;
  }

  private async readProfileSecrets(profileId: string): Promise<StoredSecrets> {
    const allSecrets = await this.readEncryptedFile();
    const encoded = allSecrets[profileId];
    if (!encoded) {
      return {};
    }

    try {
      const decrypted = safeStorage.decryptString(Buffer.from(encoded, "base64"));
      const value = JSON.parse(decrypted) as unknown;
      return value && typeof value === "object" ? (value as StoredSecrets) : {};
    } catch {
      return {};
    }
  }

  private async writeProfileSecrets(
    profileId: string,
    secrets: StoredSecrets
  ): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is unavailable");
    }

    const encrypted = safeStorage
      .encryptString(JSON.stringify(secrets))
      .toString("base64");

    this.writeChain = this.writeChain.then(async () => {
      const allSecrets = await this.readEncryptedFile();
      allSecrets[profileId] = encrypted;
      await this.writeEncryptedFile(allSecrets);
    });

    await this.writeChain;
  }

  private async readEncryptedFile(): Promise<EncryptedSecretFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as EncryptedSecretFile)
        : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  private async writeEncryptedFile(value: EncryptedSecretFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }
}
