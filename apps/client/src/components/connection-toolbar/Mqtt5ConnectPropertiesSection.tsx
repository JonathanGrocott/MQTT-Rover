import { useEffect, useState } from "react";
import { ConnectionProfile } from "@mqtt-rover/protocol";
import { parseUserProperties, serializeUserProperties, toOptionalNumber } from "./utils";

interface Props {
  profileId: string | null;
  isMqtt5: boolean;
  advancedMode: boolean;
  connectProperties: NonNullable<ConnectionProfile["mqtt5ConnectProperties"]>;
  onChange: (
    next: NonNullable<ConnectionProfile["mqtt5ConnectProperties"]>
  ) => void;
}

export function Mqtt5ConnectPropertiesSection({
  profileId,
  isMqtt5,
  advancedMode,
  connectProperties,
  onChange
}: Props) {
  const [connectUserPropertiesDraft, setConnectUserPropertiesDraft] = useState("");

  useEffect(() => {
    setConnectUserPropertiesDraft(
      serializeUserProperties(connectProperties.userProperties)
    );
  }, [profileId, connectProperties.userProperties]);

  if (!isMqtt5 || !advancedMode) {
    return null;
  }

  return (
    <details className="toolbar-accordion">
      <summary>MQTT5 Connect Properties</summary>
      <div className="toolbar-secondary">
        <div className="field-group">
          <label>MQTT5 Session Expiry (s)</label>
          <input
            value={connectProperties.sessionExpiryInterval ?? ""}
            onChange={(event) =>
              onChange({
                ...connectProperties,
                sessionExpiryInterval: toOptionalNumber(event.target.value)
              })
            }
          />
        </div>
        <div className="field-group">
          <label>MQTT5 Receive Maximum</label>
          <input
            value={connectProperties.receiveMaximum ?? ""}
            onChange={(event) =>
              onChange({
                ...connectProperties,
                receiveMaximum: toOptionalNumber(event.target.value)
              })
            }
          />
        </div>
        <div className="field-group">
          <label>MQTT5 Topic Alias Max</label>
          <input
            value={connectProperties.topicAliasMaximum ?? ""}
            onChange={(event) =>
              onChange({
                ...connectProperties,
                topicAliasMaximum: toOptionalNumber(event.target.value)
              })
            }
          />
        </div>
        <div className="field-group">
          <label>
            <input
              type="checkbox"
              checked={Boolean(connectProperties.requestResponseInformation)}
              onChange={(event) =>
                onChange({
                  ...connectProperties,
                  requestResponseInformation: event.target.checked
                })
              }
            />
            Request Response Info
          </label>
        </div>
        <div className="field-group">
          <label>
            <input
              type="checkbox"
              checked={Boolean(connectProperties.requestProblemInformation)}
              onChange={(event) =>
                onChange({
                  ...connectProperties,
                  requestProblemInformation: event.target.checked
                })
              }
            />
            Request Problem Info
          </label>
        </div>
        <div className="field-group">
          <label>MQTT5 User Props (key=value)</label>
          <textarea
            rows={2}
            value={connectUserPropertiesDraft}
            onChange={(event) => {
              setConnectUserPropertiesDraft(event.target.value);
              onChange({
                ...connectProperties,
                userProperties: parseUserProperties(event.target.value)
              });
            }}
          />
        </div>
      </div>
    </details>
  );
}
