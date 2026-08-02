import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";

const commitHash = execSync("git rev-parse --short HEAD").toString().trim();

export default defineConfig({
  plugins: [react()],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4700",
      "/ws": { target: "ws://localhost:4700", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
