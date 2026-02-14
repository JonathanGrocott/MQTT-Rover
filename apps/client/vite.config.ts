import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mqtt-rover/protocol": path.resolve(
        __dirname,
        "../../packages/protocol/src/index.ts"
      ),
      "@mqtt-rover/sparkplug": path.resolve(
        __dirname,
        "../../packages/sparkplug/src/index.ts"
      )
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          mqtt: ["mqtt"],
          sparkplug: ["protobufjs"]
        }
      }
    }
  }
});
