/**
 * SPA-Basepath-Helfer.
 *
 * Der Client wird in Prod hinter einem Reverse-Proxy unter `/app/` ausgeliefert
 * (siehe apps/web/vite.config.ts → `base`), im Dev am Root (`/`). Der
 * TanStack-Router kennt diesen Basepath (`import.meta.env.BASE_URL`) und hängt
 * ihn bei `navigate()`/`<Link>` automatisch an.
 *
 * `window.location.*` tut das NICHT — es ist origin-absolut. Ein blankes
 * `window.location.href = "/login"` springt darum in Prod auf `https://host/login`
 * (Origin-Wurzel) statt `https://host/app/login`. Die Wurzel liefert Caddy als
 * Landing-Page aus → der User landet scheinbar „zufällig" wieder auf der Landing.
 *
 * Überall, wo wir bewusst einen vollen Reload erzwingen (z.B. nach Login/Logout,
 * um die Session-Cookie sicher neu einzulesen), muss der Pfad daher durch diesen
 * Helfer laufen.
 */
export function appHref(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, ""); // "" (Dev) | "/app" (Prod)
  const p = path.startsWith("/") ? path : `/${path}`;
  // Trägt der Pfad den Basepath schon, nicht doppelt voranstellen.
  if (base && (p === base || p.startsWith(`${base}/`))) return p;
  return `${base}${p}`;
}
