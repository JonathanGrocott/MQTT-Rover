import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import { migrateLegacyProfileSecrets } from "./desktop/credentialMigration";

async function bootstrap(): Promise<void> {
  try {
    await migrateLegacyProfileSecrets();
  } catch (error) {
    console.error("Failed to migrate legacy profile credentials", error);
  }

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
