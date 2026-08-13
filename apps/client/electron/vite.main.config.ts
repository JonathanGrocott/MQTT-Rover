import { defineConfig } from "vite";

export default defineConfig({
  ssr: {
    noExternal: ["mqtt"]
  },
  build: {
    ssr: "electron/main.ts",
    outDir: ".electron",
    emptyOutDir: true,
    rollupOptions: {
      external: ["electron"],
      output: {
        entryFileNames: "main.js",
        format: "es"
      }
    },
    target: "node22"
  }
});
