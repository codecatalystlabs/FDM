import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch:
      process.platform === "win32"
        ? {
            // Work around intermittent Node/FS watcher issues on Windows.
            usePolling: true,
            interval: 250,
          }
        : undefined,
  },
  clearScreen: false,
});
