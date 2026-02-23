import { ConnectionProfile } from "@mqtt-rover/protocol";

interface Props {
  collapsed: boolean;
  advancedMode: boolean;
  profile: ConnectionProfile | null;
  onUpdateProfile: (patch: Partial<ConnectionProfile>) => void;
}

export function MtlsCredentialsSection({
  collapsed,
  advancedMode,
  profile,
  onUpdateProfile
}: Props) {
  if (collapsed || !profile?.useMtls) {
    return null;
  }

  return (
    <details className="toolbar-accordion" open={advancedMode}>
      <summary>mTLS Credentials</summary>
      <div className="toolbar-secondary">
        <div className="field-group">
          <label>CA PEM (required for desktop mTLS)</label>
          <textarea
            rows={2}
            value={profile.caCertPem ?? ""}
            onChange={(event) =>
              onUpdateProfile({ caCertPem: event.target.value })
            }
            placeholder="-----BEGIN CERTIFICATE-----"
          />
        </div>
        <div className="field-group">
          <label>Client Cert PEM</label>
          <textarea
            rows={2}
            value={profile.clientCertPem ?? ""}
            onChange={(event) =>
              onUpdateProfile({ clientCertPem: event.target.value })
            }
          />
        </div>
        <div className="field-group">
          <label>Client Key PEM</label>
          <textarea
            rows={2}
            value={profile.clientKeyPem ?? ""}
            onChange={(event) =>
              onUpdateProfile({ clientKeyPem: event.target.value })
            }
          />
        </div>
      </div>
    </details>
  );
}
