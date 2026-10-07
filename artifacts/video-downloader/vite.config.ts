import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@workspace/api-client-react": path.resolve(__dirname, "./src/lib/api-client"),
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    allowedHosts: [
      ".ngrok-free.app",
      ".ngrok-free.dev",
      ".ngrok.io",
      ".trycloudflare.com",
      "gallantly-skydiver-raving.ngrok-free.dev",
    ],
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
