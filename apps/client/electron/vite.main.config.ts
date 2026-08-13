import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "electron/main.ts",
    outDir: ".electron",
    emptyOutDir: true,
    rollupOptions: {
      external: ["electron", "mqtt"],
      output: {
        entryFileNames: "main.js",
        format: "es"
      }
    },
    target: "node22"
  }
});
