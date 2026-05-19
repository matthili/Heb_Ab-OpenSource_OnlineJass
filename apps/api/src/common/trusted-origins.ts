/**
 * Einzige Quelle der Wahrheit für „welche Origins darf unser Frontend
 * haben". Sowohl der CORS-Layer in `main.ts` als auch der
 * `OriginCheckGuard` lesen aus dieser Liste — dadurch ist garantiert,
 * dass Browser-CORS und Server-Anti-CSRF dieselben Hosts erlauben /
 * ablehnen.
 *
 * Inputs:
 *   - `BETTER_AUTH_URL`       — Base-URL der API selbst (Better Auth braucht das)
 *   - `WEB_PUBLIC_URL`        — Web-SPA Origin (Vite-Dev oder Prod-Domain)
 *   - `LANDING_PUBLIC_URL`    — Astro-Landing (kann gleich Web sein)
 *   - `TRUSTED_ORIGINS`       — komma-separierte Liste zusätzlicher Hosts
 *
 * Defaults sind localhost-Werte für Dev. **In production wird `getTrustedOrigins()`
 * verlangen, dass `WEB_PUBLIC_URL` explizit gesetzt ist** (sonst lehnen
 * Browser-Anfragen vom echten Frontend einfach ab — viel besser als
 * stilles „funktioniert von überall").
 *
 * Wildcard-Origins (`*`) sind NIE erlaubt, weil wir mit `credentials: true`
 * arbeiten — die Spec verbietet die Kombination, und sie ist eine
 * CSRF-Falle (jede Domain kann authentifizierte Reads machen).
 */

const FALLBACK_API = "http://localhost:3000";
const FALLBACK_WEB = "http://localhost:5173";
const FALLBACK_LANDING = "http://localhost:4321";

export function getTrustedOrigins(): readonly string[] {
  const env = process.env["NODE_ENV"] ?? "development";

  const apiUrl = process.env["BETTER_AUTH_URL"] ?? (env === "production" ? "" : FALLBACK_API);
  const webUrl = process.env["WEB_PUBLIC_URL"] ?? (env === "production" ? "" : FALLBACK_WEB);
  const landingUrl =
    process.env["LANDING_PUBLIC_URL"] ?? (env === "production" ? "" : FALLBACK_LANDING);

  if (env === "production") {
    if (!webUrl) {
      throw new Error(
        "WEB_PUBLIC_URL ist in production Pflicht — sonst weiß die API nicht, " +
          "welcher Browser-Origin Cookies senden darf."
      );
    }
    if (!apiUrl) {
      throw new Error("BETTER_AUTH_URL ist in production Pflicht (= API-Base-URL).");
    }
  }

  const extra = (process.env["TRUSTED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Set zur Deduplizierung. Wildcards explizit rausfiltern — wenn jemand
  // `*` in TRUSTED_ORIGINS schreibt, ignorieren wir das stillschweigend
  // und loggen es nicht (sonst hätten wir einen "guten Weg, das zu tun"
  // dokumentiert).
  const all = [apiUrl, webUrl, landingUrl, ...extra].filter((u) => u && u !== "*");
  return [...new Set(all)];
}

/**
 * Strikter Vergleich: Origin-Header (z.B. "https://heb-ab.example.com")
 * muss **exakt** in der Trust-Liste vorkommen. Keine Pfade, keine
 * Wildcards, keine Subdomain-Matches — das wäre eine subtile Lücke
 * (Angreifer kontrolliert subdomain.attacker.example.com → würde matchen).
 */
export function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return getTrustedOrigins().includes(origin);
}
