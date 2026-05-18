/**
 * Konfig für `@vite-pwa/assets-generator`. Generiert PWA-Icons aus
 * `public/favicon.svg`. Lauf:
 *
 *   pnpm --filter @jass/web pwa:assets
 *
 * Das schreibt PNGs nach `public/icons/`. Die Manifest-Pfade in
 * `vite.config.ts` zeigen exakt darauf. Wird einmalig laufen gelassen;
 * Output ist im Git eingecheckt, weil der Generator native ImageMagick-
 * Bindings braucht und das in CI Schmerz spart.
 */
import { defineConfig, minimalPreset } from "@vite-pwa/assets-generator/config";

export default defineConfig({
  preset: {
    ...minimalPreset,
    transparent: {
      sizes: [64, 192, 512],
      favicons: [[48, "favicon.ico"]],
    },
    maskable: {
      sizes: [512],
      // Maskable: Padding für die runde Maske auf Android-Launchern.
      padding: 0.3,
      resizeOptions: { background: "#1f2937" },
    },
    apple: {
      sizes: [180],
      padding: 0.3,
      resizeOptions: { background: "#1f2937" },
    },
  },
  images: ["public/favicon.svg"],
});
