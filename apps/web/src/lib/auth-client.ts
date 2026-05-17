/**
 * Better-Auth-Client für die Spiel-SPA.
 *
 * **BaseURL**: Wir nutzen den relativen Pfad `/api/auth` — damit landet
 * der Call in Dev über den Vite-Proxy bei `:3000`, und in Production
 * via Caddy gleichermaßen am API-Container. Same-Origin-Cookies bleiben
 * dadurch unproblematisch.
 *
 * **Hooks**: Better-Auth liefert `useSession()` und die `signIn`/`signUp`/
 * `signOut`-Helpers als React-Hooks aus dem `/react`-Subpath.
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "/api/auth",
});

export const { useSession, signIn, signUp, signOut } = authClient;
