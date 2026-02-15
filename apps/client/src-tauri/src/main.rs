#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rumqttc::v5::mqttbytes::v5::{
    ConnectProperties as V5ConnectProperties, Filter as V5Filter,
    PublishProperties as V5PublishProperties, RetainForwardRule as V5RetainForwardRule,
    SubscribeProperties as V5SubscribeProperties,
};
use rumqttc::v5::mqttbytes::QoS as QoSV5;
use rumqttc::v5::{
    Client as ClientV5, Event as EventV5, Incoming as IncomingV5, MqttOptions as MqttOptionsV5,
};
use rumqttc::{
    Client as ClientV4, Event as EventV4, Incoming as IncomingV4, MqttOptions as MqttOptionsV4,
    QoS, TlsConfiguration, Transport,
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TcpProfile {
    protocol: String,
    mqtt_protocol_version: Option<u8>,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    client_id: Option<String>,
    clean: Option<bool>,
    keepalive: Option<u64>,
    subscription_filter: Option<String>,
    initial_subscriptions: Option<Vec<TcpSubscription>>,
    mqtt5_connect_properties: Option<TcpMqtt5ConnectProperties>,
    use_mtls: Option<bool>,
    ca_cert_pem: Option<String>,
    client_cert_pem: Option<String>,
    client_key_pem: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TcpSubscription {
    topic_filter: String,
    qos: u8,
    mqtt5: Option<SubscribeMqtt5Properties>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UserProperty {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TcpMqtt5ConnectProperties {
    session_expiry_interval: Option<u32>,
    receive_maximum: Option<u16>,
    topic_alias_maximum: Option<u16>,
    request_response_information: Option<bool>,
    request_problem_information: Option<bool>,
    user_properties: Option<Vec<UserProperty>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PublishMqtt5Properties {
    payload_format_indicator: Option<u8>,
    message_expiry_interval: Option<u32>,
    topic_alias: Option<u16>,
    response_topic: Option<String>,
    correlation_data: Option<String>,
    content_type: Option<String>,
    user_properties: Option<Vec<UserProperty>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SubscribeMqtt5Properties {
    no_local: Option<bool>,
    retain_as_published: Option<bool>,
    retain_handling: Option<u8>,
    subscription_identifier: Option<u32>,
    user_properties: Option<Vec<UserProperty>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishRequest {
    topic: String,
    payload: String,
    qos: u8,
    retain: bool,
    mqtt5: Option<PublishMqtt5Properties>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscribeRequest {
    topic_filter: String,
    qos: u8,
    mqtt5: Option<SubscribeMqtt5Properties>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutgoingUserProperty {
    key: String,
    value: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutgoingMqtt5Properties {
    payload_format_indicator: Option<u8>,
    message_expiry_interval: Option<u32>,
    response_topic: Option<String>,
    correlation_data: Option<String>,
    content_type: Option<String>,
    subscription_identifier: Option<Vec<u32>>,
    user_properties: Option<Vec<OutgoingUserProperty>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutgoingMessage {
    topic: String,
    payload: Vec<u8>,
    qos: u8,
    retain: bool,
    timestamp: u64,
    mqtt5: Option<OutgoingMqtt5Properties>,
}

enum SessionClient {
    V4(ClientV4),
    V5(ClientV5),
}

struct MqttSession {
    client: SessionClient,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct AppRuntime {
    session: Mutex<Option<MqttSession>>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn non_empty(value: &Option<String>) -> Option<String> {
    value.as_ref().and_then(|entry| {
        if entry.trim().is_empty() {
            None
        } else {
            Some(entry.clone())
        }
    })
}

fn qos_from_u8(value: u8) -> Result<QoS, String> {
    match value {
        0 => Ok(QoS::AtMostOnce),
        1 => Ok(QoS::AtLeastOnce),
        2 => Ok(QoS::ExactlyOnce),
        _ => Err(format!("Invalid QoS: {}", value)),
    }
}

fn qos_to_u8(value: QoS) -> u8 {
    match value {
        QoS::AtMostOnce => 0,
        QoS::AtLeastOnce => 1,
        QoS::ExactlyOnce => 2,
    }
}

fn qos_v5_from_u8(value: u8) -> Result<QoSV5, String> {
    match value {
        0 => Ok(QoSV5::AtMostOnce),
        1 => Ok(QoSV5::AtLeastOnce),
        2 => Ok(QoSV5::ExactlyOnce),
        _ => Err(format!("Invalid QoS: {}", value)),
    }
}

fn qos_v5_to_u8(value: QoSV5) -> u8 {
    match value {
        QoSV5::AtMostOnce => 0,
        QoSV5::AtLeastOnce => 1,
        QoSV5::ExactlyOnce => 2,
    }
}

fn bool_to_mqtt5_flag(value: Option<bool>) -> Option<u8> {
    value.map(|entry| if entry { 1 } else { 0 })
}

fn bytes_to_hex(data: &[u8]) -> String {
    let mut output = String::with_capacity(data.len() * 2);
    for byte in data {
        output.push_str(&format!("{:02x}", byte));
    }
    output
}

fn user_property_pairs(value: &Option<Vec<UserProperty>>) -> Vec<(String, String)> {
    value
        .clone()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            let key = entry.key.trim().to_string();
            if key.is_empty() {
                return None;
            }
            Some((key, entry.value))
        })
        .collect()
}

fn to_outgoing_user_properties(value: &[(String, String)]) -> Option<Vec<OutgoingUserProperty>> {
    if value.is_empty() {
        return None;
    }
    Some(
        value
            .iter()
            .map(|(key, value)| OutgoingUserProperty {
                key: key.clone(),
                value: value.clone(),
            })
            .collect(),
    )
}

fn retain_forward_rule(value: Option<u8>) -> Result<V5RetainForwardRule, String> {
    match value.unwrap_or(0) {
        0 => Ok(V5RetainForwardRule::OnEverySubscribe),
        1 => Ok(V5RetainForwardRule::OnNewSubscribe),
        2 => Ok(V5RetainForwardRule::Never),
        other => Err(format!("Invalid retain handling: {}", other)),
    }
}

fn normalize_initial_subscriptions(profile: &TcpProfile) -> Vec<TcpSubscription> {
    let mut subscriptions = profile
        .initial_subscriptions
        .clone()
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| !entry.topic_filter.trim().is_empty())
        .collect::<Vec<_>>();

    if subscriptions.is_empty() {
        subscriptions.push(TcpSubscription {
            topic_filter: non_empty(&profile.subscription_filter).unwrap_or("#".to_string()),
            qos: 0,
            mqtt5: None,
        });
    }

    subscriptions
}

fn apply_transport(
    protocol: &str,
    use_mtls: Option<bool>,
    ca_cert_pem: &Option<String>,
    client_cert_pem: &Option<String>,
    client_key_pem: &Option<String>,
    set_transport: impl FnOnce(Transport),
) -> Result<(), String> {
    if protocol != "mqtts" {
        return Ok(());
    }

    if use_mtls.unwrap_or(false) {
        let ca = non_empty(ca_cert_pem)
            .ok_or_else(|| "CA certificate PEM is required when mTLS is enabled".to_string())?
            .into_bytes();
        let client_cert = non_empty(client_cert_pem)
            .ok_or_else(|| "Client certificate PEM is required when mTLS is enabled".to_string())?
            .into_bytes();
        let client_key = non_empty(client_key_pem)
            .ok_or_else(|| "Client key PEM is required when mTLS is enabled".to_string())?
            .into_bytes();

        set_transport(Transport::Tls(TlsConfiguration::Simple {
            ca,
            alpn: None,
            client_auth: Some((client_cert, client_key)),
        }));
        return Ok(());
    }

    set_transport(Transport::tls_with_default_config());
    Ok(())
}

fn mqtt_options_v4_from_profile(profile: &TcpProfile) -> Result<MqttOptionsV4, String> {
    if profile.host.trim().is_empty() {
        return Err("Host is required".to_string());
    }

    let client_id = non_empty(&profile.client_id)
        .unwrap_or_else(|| format!("mqtt-rover-{}", now_millis()));

    let mut options = MqttOptionsV4::new(client_id, profile.host.clone(), profile.port);
    options.set_clean_session(profile.clean.unwrap_or(true));
    options.set_keep_alive(Duration::from_secs(profile.keepalive.unwrap_or(30)));

    if let Some(username) = non_empty(&profile.username) {
        options.set_credentials(username, profile.password.clone().unwrap_or_default());
    }

    apply_transport(
        &profile.protocol,
        profile.use_mtls,
        &profile.ca_cert_pem,
        &profile.client_cert_pem,
        &profile.client_key_pem,
        |transport| {
            options.set_transport(transport);
        },
    )?;

    Ok(options)
}

fn mqtt_options_v5_from_profile(profile: &TcpProfile) -> Result<MqttOptionsV5, String> {
    if profile.host.trim().is_empty() {
        return Err("Host is required".to_string());
    }

    let client_id = non_empty(&profile.client_id)
        .unwrap_or_else(|| format!("mqtt-rover-{}", now_millis()));

    let mut options = MqttOptionsV5::new(client_id, profile.host.clone(), profile.port);
    options.set_clean_start(profile.clean.unwrap_or(true));
    options.set_keep_alive(Duration::from_secs(profile.keepalive.unwrap_or(30)));

    if let Some(username) = non_empty(&profile.username) {
        options.set_credentials(username, profile.password.clone().unwrap_or_default());
    }

    if let Some(connect) = &profile.mqtt5_connect_properties {
        let mut properties = V5ConnectProperties::new();
        properties.session_expiry_interval = connect.session_expiry_interval;
        properties.receive_maximum = connect.receive_maximum;
        properties.topic_alias_max = connect.topic_alias_maximum;
        properties.request_response_info =
            bool_to_mqtt5_flag(connect.request_response_information);
        properties.request_problem_info =
            bool_to_mqtt5_flag(connect.request_problem_information);
        properties.user_properties = user_property_pairs(&connect.user_properties);
        options.set_connect_properties(properties);
    }

    apply_transport(
        &profile.protocol,
        profile.use_mtls,
        &profile.ca_cert_pem,
        &profile.client_cert_pem,
        &profile.client_key_pem,
        |transport| {
            options.set_transport(transport);
        },
    )?;

    Ok(options)
}

fn subscribe_v5(
    client: &ClientV5,
    topic_filter: String,
    qos: QoSV5,
    mqtt5: &Option<SubscribeMqtt5Properties>,
) -> Result<(), String> {
    let mut filter = V5Filter::new(topic_filter.clone(), qos);

    if let Some(properties) = mqtt5 {
        filter.nolocal = properties.no_local.unwrap_or(false);
        filter.preserve_retain = properties.retain_as_published.unwrap_or(false);
        filter.retain_forward_rule = retain_forward_rule(properties.retain_handling)?;
    }

    let has_filter_options = mqtt5
        .as_ref()
        .map(|entry| {
            entry.no_local.unwrap_or(false)
                || entry.retain_as_published.unwrap_or(false)
                || entry.retain_handling.is_some()
        })
        .unwrap_or(false);

    let subscribe_properties = mqtt5.as_ref().and_then(|entry| {
        let id = entry.subscription_identifier.map(|value| value as usize);
        let user_properties = user_property_pairs(&entry.user_properties);
        if id.is_none() && user_properties.is_empty() {
            return None;
        }
        Some(V5SubscribeProperties {
            id,
            user_properties,
        })
    });

    if has_filter_options || subscribe_properties.is_some() {
        if let Some(properties) = subscribe_properties {
            client
                .subscribe_many_with_properties(vec![filter], properties)
                .map_err(|error| format!("Subscribe failed: {}", error))?;
        } else {
            client
                .subscribe_many(vec![filter])
                .map_err(|error| format!("Subscribe failed: {}", error))?;
        }
        return Ok(());
    }

    client
        .subscribe(topic_filter, qos)
        .map_err(|error| format!("Subscribe failed: {}", error))
}

fn emit_runtime_error(app: &tauri::AppHandle, message: &str) {
    let _ = app.emit("mqtt://error", message.to_string());
    let _ = app.emit("mqtt://status", "error");
}

fn disconnect_session(session: MqttSession) {
    session.stop.store(true, Ordering::Relaxed);
    match session.client {
        SessionClient::V4(client) => {
            let _ = client.disconnect();
        }
        SessionClient::V5(client) => {
            let _ = client.disconnect();
        }
    }
    if let Some(worker) = session.worker {
        let _ = worker.join();
    }
}

fn connect_v4(app: &tauri::AppHandle, profile: &TcpProfile) -> Result<MqttSession, String> {
    let options = mqtt_options_v4_from_profile(profile)?;
    let (client, mut connection) = ClientV4::new(options, 1024);

    for entry in normalize_initial_subscriptions(profile) {
        let qos = qos_from_u8(entry.qos)?;
        client
            .subscribe(entry.topic_filter, qos)
            .map_err(|error| format!("Subscribe failed: {}", error))?;
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_worker = stop.clone();
    let app_for_worker = app.clone();

    let worker = std::thread::spawn(move || {
        for notification in connection.iter() {
            if stop_for_worker.load(Ordering::Relaxed) {
                break;
            }

            match notification {
                Ok(EventV4::Incoming(IncomingV4::ConnAck(_))) => {
                    let _ = app_for_worker.emit("mqtt://status", "connected");
                }
                Ok(EventV4::Incoming(IncomingV4::Publish(packet))) => {
                    let message = OutgoingMessage {
                        topic: packet.topic,
                        payload: packet.payload.to_vec(),
                        qos: qos_to_u8(packet.qos),
                        retain: packet.retain,
                        timestamp: now_millis(),
                        mqtt5: None,
                    };
                    let _ = app_for_worker.emit("mqtt://message", message);
                }
                Ok(EventV4::Incoming(IncomingV4::Disconnect)) => {
                    let _ = app_for_worker.emit("mqtt://status", "disconnected");
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    if !stop_for_worker.load(Ordering::Relaxed) {
                        let _ = app_for_worker.emit("mqtt://error", error.to_string());
                        let _ = app_for_worker.emit("mqtt://status", "error");
                    }
                    break;
                }
            }
        }
    });

    Ok(MqttSession {
        client: SessionClient::V4(client),
        stop,
        worker: Some(worker),
    })
}

fn connect_v5(app: &tauri::AppHandle, profile: &TcpProfile) -> Result<MqttSession, String> {
    let options = mqtt_options_v5_from_profile(profile)?;
    let (client, mut connection) = ClientV5::new(options, 1024);

    for entry in normalize_initial_subscriptions(profile) {
        let qos = qos_v5_from_u8(entry.qos)?;
        subscribe_v5(&client, entry.topic_filter, qos, &entry.mqtt5)?;
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_worker = stop.clone();
    let app_for_worker = app.clone();

    let worker = std::thread::spawn(move || {
        for notification in connection.iter() {
            if stop_for_worker.load(Ordering::Relaxed) {
                break;
            }

            match notification {
                Ok(EventV5::Incoming(IncomingV5::ConnAck(_))) => {
                    let _ = app_for_worker.emit("mqtt://status", "connected");
                }
                Ok(EventV5::Incoming(IncomingV5::Publish(packet))) => {
                    let properties = packet.properties.as_ref().map(|entry| {
                        OutgoingMqtt5Properties {
                            payload_format_indicator: entry.payload_format_indicator,
                            message_expiry_interval: entry.message_expiry_interval,
                            response_topic: entry.response_topic.clone(),
                            correlation_data: entry
                                .correlation_data
                                .as_ref()
                                .map(|value| bytes_to_hex(value)),
                            content_type: entry.content_type.clone(),
                            subscription_identifier: if entry.subscription_identifiers.is_empty() {
                                None
                            } else {
                                Some(
                                    entry
                                        .subscription_identifiers
                                        .iter()
                                        .map(|value| *value as u32)
                                        .collect(),
                                )
                            },
                            user_properties: to_outgoing_user_properties(&entry.user_properties),
                        }
                    });

                    let message = OutgoingMessage {
                        topic: String::from_utf8_lossy(&packet.topic).to_string(),
                        payload: packet.payload.to_vec(),
                        qos: qos_v5_to_u8(packet.qos),
                        retain: packet.retain,
                        timestamp: now_millis(),
                        mqtt5: properties,
                    };
                    let _ = app_for_worker.emit("mqtt://message", message);
                }
                Ok(EventV5::Incoming(IncomingV5::Disconnect(_))) => {
                    let _ = app_for_worker.emit("mqtt://status", "disconnected");
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    if !stop_for_worker.load(Ordering::Relaxed) {
                        let _ = app_for_worker.emit("mqtt://error", error.to_string());
                        let _ = app_for_worker.emit("mqtt://status", "error");
                    }
                    break;
                }
            }
        }
    });

    Ok(MqttSession {
        client: SessionClient::V5(client),
        stop,
        worker: Some(worker),
    })
}

#[tauri::command]
async fn connect_tcp(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, AppRuntime>,
    profile: TcpProfile,
) -> Result<(), String> {
    if profile.protocol != "mqtt" && profile.protocol != "mqtts" {
        let message = format!(
            "Invalid protocol '{}' for desktop transport (expected mqtt/mqtts)",
            profile.protocol
        );
        emit_runtime_error(&app, &message);
        return Err(message);
    }

    app.emit("mqtt://status", "connecting")
        .map_err(|error| {
            let message = error.to_string();
            emit_runtime_error(&app, &message);
            message
        })?;

    let existing_session = {
        let mut guard = runtime
            .session
            .lock()
            .map_err(|_| {
                let message = "Runtime lock poisoned".to_string();
                emit_runtime_error(&app, &message);
                message
            })?;
        guard.take()
    };

    if let Some(session) = existing_session {
        disconnect_session(session);
    }

    let session = match profile.mqtt_protocol_version.unwrap_or(4) {
        5 => connect_v5(&app, &profile),
        _ => connect_v4(&app, &profile),
    };

    let next_session = match session {
        Ok(value) => value,
        Err(message) => {
            emit_runtime_error(&app, &message);
            return Err(message);
        }
    };

    {
        let mut guard = runtime
            .session
            .lock()
            .map_err(|_| {
                let message = "Runtime lock poisoned".to_string();
                emit_runtime_error(&app, &message);
                message
            })?;
        *guard = Some(next_session);
    }

    Ok(())
}

#[tauri::command]
async fn publish_tcp(
    runtime: tauri::State<'_, AppRuntime>,
    request: PublishRequest,
) -> Result<(), String> {
    if request.topic.trim().is_empty() {
        return Err("Publish topic is required".to_string());
    }

    let client = {
        let guard = runtime
            .session
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        guard
            .as_ref()
            .map(|session| match &session.client {
                SessionClient::V4(client) => SessionClient::V4(client.clone()),
                SessionClient::V5(client) => SessionClient::V5(client.clone()),
            })
            .ok_or_else(|| "Not connected".to_string())?
    };

    match client {
        SessionClient::V4(client) => {
            let qos = qos_from_u8(request.qos)?;
            if request.mqtt5.is_some() {
                return Err("MQTT5 publish properties require an MQTT5 connection".to_string());
            }
            client
                .publish(request.topic, qos, request.retain, request.payload)
                .map_err(|error| format!("Publish failed: {}", error))
        }
        SessionClient::V5(client) => {
            let qos = qos_v5_from_u8(request.qos)?;
            let properties = request.mqtt5.map(|entry| V5PublishProperties {
                payload_format_indicator: entry.payload_format_indicator,
                message_expiry_interval: entry.message_expiry_interval,
                topic_alias: entry.topic_alias,
                response_topic: non_empty(&entry.response_topic),
                correlation_data: entry
                    .correlation_data
                    .map(|value| value.into_bytes().into()),
                user_properties: user_property_pairs(&entry.user_properties),
                subscription_identifiers: vec![],
                content_type: non_empty(&entry.content_type),
            });

            if let Some(properties) = properties {
                client
                    .publish_with_properties(
                        request.topic,
                        qos,
                        request.retain,
                        request.payload,
                        properties,
                    )
                    .map_err(|error| format!("Publish failed: {}", error))
            } else {
                client
                    .publish(request.topic, qos, request.retain, request.payload)
                    .map_err(|error| format!("Publish failed: {}", error))
            }
        }
    }
}

#[tauri::command]
async fn subscribe_tcp(
    runtime: tauri::State<'_, AppRuntime>,
    request: SubscribeRequest,
) -> Result<(), String> {
    let topic_filter = request.topic_filter.trim().to_string();
    if topic_filter.is_empty() {
        return Err("Topic filter is required".to_string());
    }

    let client = {
        let guard = runtime
            .session
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        guard
            .as_ref()
            .map(|session| match &session.client {
                SessionClient::V4(client) => SessionClient::V4(client.clone()),
                SessionClient::V5(client) => SessionClient::V5(client.clone()),
            })
            .ok_or_else(|| "Not connected".to_string())?
    };

    match client {
        SessionClient::V4(client) => {
            let qos = qos_from_u8(request.qos)?;
            if request.mqtt5.is_some() {
                return Err("MQTT5 subscribe properties require an MQTT5 connection".to_string());
            }
            client
                .subscribe(topic_filter, qos)
                .map_err(|error| format!("Subscribe failed: {}", error))
        }
        SessionClient::V5(client) => {
            let qos = qos_v5_from_u8(request.qos)?;
            subscribe_v5(&client, topic_filter, qos, &request.mqtt5)
        }
    }
}

#[tauri::command]
async fn unsubscribe_tcp(
    runtime: tauri::State<'_, AppRuntime>,
    topic_filter: String,
) -> Result<(), String> {
    if topic_filter.trim().is_empty() {
        return Err("Topic filter is required".to_string());
    }

    let client = {
        let guard = runtime
            .session
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        guard
            .as_ref()
            .map(|session| match &session.client {
                SessionClient::V4(client) => SessionClient::V4(client.clone()),
                SessionClient::V5(client) => SessionClient::V5(client.clone()),
            })
            .ok_or_else(|| "Not connected".to_string())?
    };

    match client {
        SessionClient::V4(client) => client
            .unsubscribe(topic_filter)
            .map_err(|error| format!("Unsubscribe failed: {}", error)),
        SessionClient::V5(client) => client
            .unsubscribe(topic_filter)
            .map_err(|error| format!("Unsubscribe failed: {}", error)),
    }
}

#[tauri::command]
async fn disconnect_tcp(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, AppRuntime>,
) -> Result<(), String> {
    let existing_session = {
        let mut guard = runtime
            .session
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        guard.take()
    };

    if let Some(session) = existing_session {
        disconnect_session(session);
    }

    app.emit("mqtt://status", "disconnected")
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(AppRuntime::default())
        .invoke_handler(tauri::generate_handler![
            connect_tcp,
            publish_tcp,
            subscribe_tcp,
            unsubscribe_tcp,
            disconnect_tcp
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
