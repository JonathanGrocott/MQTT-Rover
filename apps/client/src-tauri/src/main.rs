#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rumqttc::{Client, Event, Incoming, MqttOptions, QoS, TlsConfiguration, Transport};
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
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    client_id: Option<String>,
    clean: Option<bool>,
    keepalive: Option<u64>,
    subscription_filter: Option<String>,
    use_mtls: Option<bool>,
    ca_cert_pem: Option<String>,
    client_cert_pem: Option<String>,
    client_key_pem: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishRequest {
    topic: String,
    payload: String,
    qos: u8,
    retain: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutgoingMessage {
    topic: String,
    payload: Vec<u8>,
    qos: u8,
    retain: bool,
    timestamp: u64,
}

struct MqttSession {
    client: Client,
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

fn disconnect_session(session: MqttSession) {
    session.stop.store(true, Ordering::Relaxed);
    let _ = session.client.disconnect();
    if let Some(worker) = session.worker {
        let _ = worker.join();
    }
}

fn mqtt_options_from_profile(profile: &TcpProfile) -> Result<MqttOptions, String> {
    if profile.host.trim().is_empty() {
        return Err("Host is required".to_string());
    }

    let client_id = non_empty(&profile.client_id)
        .unwrap_or_else(|| format!("mqtt-rover-{}", now_millis()));

    let mut options = MqttOptions::new(client_id, profile.host.clone(), profile.port);
    options.set_clean_session(profile.clean.unwrap_or(true));
    options.set_keep_alive(Duration::from_secs(profile.keepalive.unwrap_or(30)));

    if let Some(username) = non_empty(&profile.username) {
        options.set_credentials(username, profile.password.clone().unwrap_or_default());
    }

    if profile.protocol == "mqtts" {
        if profile.use_mtls.unwrap_or(false) {
            let ca = non_empty(&profile.ca_cert_pem)
                .ok_or_else(|| "CA certificate PEM is required when mTLS is enabled".to_string())?
                .into_bytes();
            let client_cert = non_empty(&profile.client_cert_pem)
                .ok_or_else(|| {
                    "Client certificate PEM is required when mTLS is enabled".to_string()
                })?
                .into_bytes();
            let client_key = non_empty(&profile.client_key_pem)
                .ok_or_else(|| "Client key PEM is required when mTLS is enabled".to_string())?
                .into_bytes();

            options.set_transport(Transport::Tls(TlsConfiguration::Simple {
                ca,
                alpn: None,
                client_auth: Some((client_cert, client_key)),
            }));
        } else {
            options.set_transport(Transport::tls_with_default_config());
        }
    }

    Ok(options)
}

#[tauri::command]
async fn connect_tcp(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, AppRuntime>,
    profile: TcpProfile,
) -> Result<(), String> {
    if profile.protocol != "mqtt" && profile.protocol != "mqtts" {
        return Err(format!(
            "Invalid protocol '{}' for desktop transport (expected mqtt/mqtts)",
            profile.protocol
        ));
    }

    app.emit("mqtt://status", "connecting")
        .map_err(|error| error.to_string())?;

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

    let options = mqtt_options_from_profile(&profile)?;
    let subscription_filter = non_empty(&profile.subscription_filter).unwrap_or("#".to_string());
    let (client, mut connection) = Client::new(options, 1024);
    client
        .subscribe(subscription_filter, QoS::AtMostOnce)
        .map_err(|error| format!("Subscribe failed: {}", error))?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_worker = stop.clone();
    let app_for_worker = app.clone();

    let worker = std::thread::spawn(move || {
        for notification in connection.iter() {
            if stop_for_worker.load(Ordering::Relaxed) {
                break;
            }

            match notification {
                Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                    let _ = app_for_worker.emit("mqtt://status", "connected");
                }
                Ok(Event::Incoming(Incoming::Publish(packet))) => {
                    let message = OutgoingMessage {
                        topic: packet.topic,
                        payload: packet.payload.to_vec(),
                        qos: qos_to_u8(packet.qos),
                        retain: packet.retain,
                        timestamp: now_millis(),
                    };
                    let _ = app_for_worker.emit("mqtt://message", message);
                }
                Ok(Event::Incoming(Incoming::Disconnect)) => {
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

    let next_session = MqttSession {
        client,
        stop,
        worker: Some(worker),
    };

    {
        let mut guard = runtime
            .session
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
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

    let qos = qos_from_u8(request.qos)?;

    let client = {
        let guard = runtime
            .session
            .lock()
            .map_err(|_| "Runtime lock poisoned".to_string())?;
        guard
            .as_ref()
            .map(|session| session.client.clone())
            .ok_or_else(|| "Not connected".to_string())?
    };

    client
        .publish(request.topic, qos, request.retain, request.payload)
        .map_err(|error| format!("Publish failed: {}", error))
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
        .invoke_handler(tauri::generate_handler![connect_tcp, publish_tcp, disconnect_tcp])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
