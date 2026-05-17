import react from "@astrojs/react";
import { defineConfig } from "astro/config";

/**
 * Landing-Site läuft mit vanilla CSS, NICHT mit Tailwind. Stand 2026-05-17
 * hat `@tailwindcss/vite@4.3` einen offenen Inkompat-Bug mit Vite 8 +
 * Rolldown (`Missing field 'tsconfigPaths'`). Die Marketing-Site hat
 * sowieso nur 5 Seiten Text — vanilla CSS reicht.
 *
 * Die Spiel-SPA in `apps/web` nutzt Tailwind weiterhin (dort läuft der
 * Vite-Plugin sauber).
 */
export default defineConfig({
  integrations: [react()],
  // Landing-Site wird in Prod unter "/" gehostet; die Spiel-SPA hängt
  // unter "/app/". Caddy routet die beiden Pfad-Präfixe an die richtigen
  // Container.
  site: "https://heb-ab.example.com",
});
