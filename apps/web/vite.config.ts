/**
 * Vite-Config für die Spiel-SPA.
 *
 * Plugin-Reihenfolge wichtig:
 *   1. `TanStackRouterVite` muss VOR `react()` laufen — es generiert die
 *      `routeTree.gen.ts`, die der React-Plugin dann mit-transformt.
 *   2. `tailwindcss()` läuft als Vite-Plugin (Tailwind 4 ist kein
 *      Post-CSS-Plugin mehr).
 *
 * **Dev-Proxy**: API-Calls gehen via `/api/*` an `http://localhost:3000`,
 * WebSockets via `/ws` ebenfalls. Damit funktioniert Cookie-Auth (gleiche
 * Origin in der Dev-Sicht) ohne CORS-Akrobatik.
 */
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "~": new URL("./src/", import.meta.url).pathname },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/ws": { target: "http://localhost:3000", ws: true, changeOrigin: true },
    },
  },
});
