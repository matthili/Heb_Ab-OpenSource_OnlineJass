/**
 * Better-Auth-Client für die Spiel-SPA.
 *
 * **BaseURL**: Better-Auth (≥ 1.6) validiert die URL strikt und verlangt
 * ein Protokoll — der bisherige relative Pfad `/api/auth` führte zu
 * „Invalid base URL"-Crash beim Bootstrap. Wir bauen die absolute URL
 * deshalb aus `window.location.origin` zusammen. Ergebnis:
 *
 *   - Dev:  `http://localhost:5173/api/auth` → Vite-Proxy → `:3000`
 *   - Prod: `https://jass.example.com/api/auth` → Caddy → API
 *
 * Beides bleibt same-origin, der Better-Auth-Cookie funktioniert weiterhin
 * ohne CORS-Akrobatik.
 *
 * **SSR-Safety**: `typeof window` wird abgefragt, falls die Datei je in
 * einem Test- oder Node-Kontext geladen wird. Im Browser ist `window`
 * immer da.
 *
 * **Hooks**: Better-Auth liefert `useSession()` und die `signIn`/`signUp`/
 * `signOut`-Helpers als React-Hooks aus dem `/react`-Subpath.
 */
import { createAuthClient } from "better-auth/react";

const baseURL =
  typeof window !== "undefined"
    ? `${window.location.origin}/api/auth`
    : "http://localhost:5173/api/auth";

export const authClient = createAuthClient({
  baseURL,
});

export const { useSession, signIn, signUp, signOut } = authClient;
