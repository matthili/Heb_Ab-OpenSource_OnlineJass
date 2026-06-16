/**
 * Vite-Config für die Spiel-SPA.
 *
 * Plugin-Reihenfolge wichtig:
 *   1. `TanStackRouterVite` muss VOR `react()` laufen — es generiert die
 *      `routeTree.gen.ts`, die der React-Plugin dann mit-transformt.
 *   2. `tailwindcss()` läuft als Vite-Plugin (Tailwind 4 ist kein
 *      Post-CSS-Plugin mehr).
 *   3. `VitePWA()` ganz am Ende — der Plugin liest die fertige Build-
 *      Manifest und generiert den Service Worker.
 *
 * **Base-Pfad**: Im Container (Self-Host + Prod) liegt die SPA hinter dem
 * Reverse-Proxy unter `/app/` — Caddy strippt das Präfix wieder weg (siehe
 * `infra/caddy/*`), der nginx im Web-Container serviert also am Root. Damit die
 * vom Bundle erzeugten Asset-URLs, der Router-`basepath` (via
 * `import.meta.env.BASE_URL`) und die PWA-/SW-Pfade alle auf `/app/` zeigen,
 * setzen wir `base` beim **Build** auf `/app/`. Im **Dev** (Vite-Server am Root)
 * bleibt `base` `/`. API + WebSocket laufen wurzel-absolut (`/api`, `/ws`) und
 * sind vom base-Pfad unberührt.
 *
 * **Dev-Proxy**: API-Calls gehen via `/api/*` an `http://localhost:3000`,
 * WebSockets via `/ws` ebenfalls. Damit funktioniert Cookie-Auth (gleiche
 * Origin in der Dev-Sicht) ohne CORS-Akrobatik.
 *
 * **PWA (M11-A)**:
 *   - `registerType: "autoUpdate"` — neuer Service Worker installiert sich
 *     bei jedem Reload und übernimmt sofort. Wir zeigen kein „Update
 *     verfügbar"-Toast, weil unsere Builds inkrementell + risikoarm sind.
 *   - `workbox.navigateFallback`: SPA-Routing → wenn der SW eine Navigation
 *     anfordert (z.B. /lobby), serviert er die `index.html` aus dem Cache.
 *   - `workbox.runtimeCaching`: Karten-Assets (`/cards/*.png`) gehen mit
 *     **CacheFirst** in einen separaten Cache, weil sie unveränderlich sind
 *     (Inhalt steckt im Dateinamen). Damit ist das Spiel offline noch
 *     hübsch — alle 36 Karten + Trumpf-Symbole sind sofort da.
 *   - API + WS sind absichtlich NICHT gecached (NetworkOnly), weil
 *     Spielzüge live sein müssen.
 *   - In Dev (`devOptions.enabled: false`) ist der SW aus, sonst macht er
 *     die HMR-Erfahrung kaputt.
 */
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command }) => {
  // Build → hinter Reverse-Proxy unter /app/. Dev (serve) → Root. Siehe
  // Datei-Header. base endet immer auf „/" (Vite-Konvention), deshalb können
  // wir es direkt vor Pfad-Segmente hängen (`${base}index.html`).
  const base = command === "build" ? "/app/" : "/";

  return {
    base,
    plugins: [
      TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "favicon-96x96.png", "apple-touch-icon-180x180.png"],
        manifest: {
          name: "Heb ab! — Vorarlberger Kreuz-Jass",
          short_name: "Heb ab!",
          description:
            "Selbst-hostbare Multiplayer-Plattform für Vorarlberger Kreuz-Jass — mit echten Mitspielern und KI-Auffüllung.",
          theme_color: "#1f2937",
          background_color: "#fafaf9",
          display: "standalone",
          orientation: "portrait-primary",
          // start_url/scope folgen dem base-Pfad, sonst zeigt die installierte
          // PWA unter /app/ auf den falschen (Landing-)Root.
          start_url: base,
          scope: base,
          lang: "de",
          icons: [
            { src: "pwa-96x96.png", sizes: "96x96", type: "image/png" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "maskable-icon-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // SPA-Fallback: jede Navigation, die nicht in den Precache fällt,
          // landet auf index.html (TanStack-Router übernimmt dann). Muss den
          // base-Pfad tragen, weil der SW unter `${base}` scoped ist.
          navigateFallback: `${base}index.html`,
          // /api/* und /ws/* dürfen nie auf index.html landen — sonst
          // bekommen wir HTML zurück, wo JSON erwartet wird. (Wurzel-absolut,
          // unabhängig vom base-Pfad.)
          navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
          globPatterns: ["**/*.{js,css,html,svg,woff2}"],
          // Custom Push-/Notification-Click-Handler. Liegt unter public/
          // und wird zur Runtime vom generierten SW per importScripts geladen.
          importScripts: [`${base}push-handler.js`],
          // Karten-Bilder selbst sind nicht im Precache (zu viel Initial-
          // Bandbreite). Beim ersten Anzeigen werden sie in den
          // Runtime-Cache gelegt und sind danach offline verfügbar.
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith(`${base}cards/`),
              handler: "CacheFirst",
              options: {
                cacheName: "jass-card-images",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          // In Dev keine SW-Magie — HMR + dev-proxy bleiben unbeeinträchtigt.
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: { "~": new URL("./src/", import.meta.url).pathname },
    },
    server: {
      port: 5173,
      // Auf allen Netzwerk-Interfaces lauschen (nicht nur localhost), damit der
      // Dev-Server auch von anderen Geräten im LAN erreichbar ist. Vite zeigt
      // dann eine „Network:"-URL (http://<deine-LAN-IP>:5173). Zusätzlich nötig:
      // Firewall-Port 5173 freigeben + die LAN-Origin in TRUSTED_ORIGINS (API).
      host: true,
      proxy: {
        "/api": { target: "http://localhost:3000", changeOrigin: true },
        "/ws": { target: "http://localhost:3000", ws: true, changeOrigin: true },
      },
    },
  };
});
