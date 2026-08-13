import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "electron/preload.ts",
    outDir: ".electron",
    emptyOutDir: false,
    rollupOptions: {
      external: ["electron"],
      output: {
        entryFileNames: "preload.cjs",
        format: "cjs",
        inlineDynamicImports: true
      }
    },
    target: "node22"
  }
});
