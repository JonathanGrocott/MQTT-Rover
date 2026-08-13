import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConnectionProfile,
  PublishRequest,
  SubscriptionRequest
} from "@mqtt-rover/protocol";
import { ELECTRON_IPC } from "../src/desktop/electronBridge";
import { CredentialStore } from "./credentialStore";
import { MqttSessionManager } from "./mqttSessionManager";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let sessionManager: MqttSessionManager | null = null;

function validateConnectionProfile(value: ConnectionProfile): void {
  const protocols = new Set(["mqtt", "mqtts", "ws", "wss"]);
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.host !== "string" ||
    !value.host.trim() ||
    !protocols.has(value.protocol) ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65_535
  ) {
    throw new Error("Invalid connection profile");
  }
}

function validatePublishRequest(value: PublishRequest): void {
  if (
    !value ||
    typeof value.topic !== "string" ||
    !value.topic.trim() ||
    typeof value.payload !== "string" ||
    ![0, 1, 2].includes(value.qos)
  ) {
    throw new Error("Invalid publish request");
  }
}

function validateSubscriptionRequest(value: SubscriptionRequest): void {
  if (
    !value ||
    typeof value.topicFilter !== "string" ||
    !value.topicFilter.trim() ||
    ![0, 1, 2].includes(value.qos)
  ) {
    throw new Error("Invalid subscription request");
  }
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer");
  }
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: "MQTT Rover",
    width: 1580,
    height: 980,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const developmentUrl = process.env.MQTT_ROVER_DEV_SERVER_URL;
    let isAllowedDevelopmentNavigation = false;
    if (developmentUrl) {
      try {
        isAllowedDevelopmentNavigation =
          new URL(url).origin === new URL(developmentUrl).origin;
      } catch {
        isAllowedDevelopmentNavigation = false;
      }
    }
    if (!isAllowedDevelopmentNavigation) {
      event.preventDefault();
    }
  });

  const developmentUrl = process.env.MQTT_ROVER_DEV_SERVER_URL;
  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(path.join(currentDirectory, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  const credentials = new CredentialStore();
  sessionManager = new MqttSessionManager({
    onMessages: (messages) => send(ELECTRON_IPC.messageBatch, messages),
    onStatus: (state) => send(ELECTRON_IPC.status, state),
    onError: (message) => send(ELECTRON_IPC.error, message)
  });

  ipcMain.handle(
    ELECTRON_IPC.connect,
    async (event, profile: ConnectionProfile) => {
      assertTrustedSender(event);
      validateConnectionProfile(profile);
      const hydratedProfile = await credentials.hydrateAndStore(profile);
      await sessionManager?.connect(hydratedProfile);
    }
  );
  ipcMain.handle(ELECTRON_IPC.disconnect, (event) => {
    assertTrustedSender(event);
    return sessionManager?.disconnect();
  });
  ipcMain.handle(
    ELECTRON_IPC.publish,
    (event, request: PublishRequest) => {
      assertTrustedSender(event);
      validatePublishRequest(request);
      return sessionManager?.publish(request);
    }
  );
  ipcMain.handle(
    ELECTRON_IPC.subscribe,
    (event, request: SubscriptionRequest) => {
      assertTrustedSender(event);
      validateSubscriptionRequest(request);
      return sessionManager?.subscribe(request);
    }
  );
  ipcMain.handle(
    ELECTRON_IPC.unsubscribe,
    (event, topicFilter: string) => {
      assertTrustedSender(event);
      if (typeof topicFilter !== "string" || !topicFilter.trim()) {
        throw new Error("Invalid topic filter");
      }
      return sessionManager?.unsubscribe(topicFilter);
    }
  );
  ipcMain.handle(
    ELECTRON_IPC.migrateSecrets,
    (event, profiles: ConnectionProfile[]) => {
      assertTrustedSender(event);
      if (!Array.isArray(profiles) || profiles.length > 1_000) {
        throw new Error("Invalid credential migration request");
      }
      for (const profile of profiles) {
        validateConnectionProfile(profile);
      }
      return credentials.migrateProfiles(profiles);
    }
  );
  ipcMain.handle(ELECTRON_IPC.deleteSecrets, (event, profileId: string) => {
    assertTrustedSender(event);
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new Error("Invalid profile identifier");
    }
    return credentials.deleteProfile(profileId);
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  registerIpcHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void sessionManager?.disconnect(false);
});
