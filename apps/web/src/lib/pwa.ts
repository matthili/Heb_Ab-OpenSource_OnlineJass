/**
 * Service-Worker-Registrierung.
 *
 * Verwendet das Virtual-Modul `virtual:pwa-register` von `vite-plugin-pwa`,
 * das beim Build den Bootstrap-Code für den SW liefert. In Dev existiert das
 * Modul auch — wir haben `devOptions.enabled: false` gesetzt, deshalb tut
 * `register()` dort nichts.
 *
 * Strategie: `autoUpdate` — Workbox installiert neue SWs im Hintergrund und
 * übernimmt beim nächsten Reload. Wir zeigen kein „Update verfügbar"-Toast,
 * weil wir kleine, inkrementelle Releases erwarten. Wenn das später nervt,
 * lässt sich das auf `prompt` umstellen und ein Banner anbieten.
 *
 * Tests: in vitest fallen die Imports auf undefined; `registerSW` ist dann
 * nicht aufrufbar — der defensive Typeof-Check unten schluckt das.
 */
export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  try {
    // Dynamischer Import, damit vite den SW-Bootstrap auf einen separaten
    // Chunk legt und das Main-Bundle nicht aufbläht.
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({
      immediate: true,
      onRegisterError(err: unknown) {
        // Nicht laut werden — SW-Failure soll das Spiel nicht stören.
        // In Dev ohne Build erwarten wir hier `undefined`.
        console.warn("[pwa] SW-Registration fehlgeschlagen:", err);
      },
    });
  } catch (err) {
    // virtual:pwa-register existiert nur nach Vite-Build mit dem Plugin;
    // in Dev (HMR) ohne SW ist das egal.
    if (import.meta.env.PROD) {
      console.warn("[pwa] virtual:pwa-register nicht ladbar:", err);
    }
  }
}
