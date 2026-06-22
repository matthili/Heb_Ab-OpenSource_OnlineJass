/**
 * Pathless Layout-Route für eingeloggte Bereiche (Lobby, Tisch, Profile).
 *
 * Auth-Guard: ohne Session → Redirect auf `/login` mit Rück-URL als
 * Query-Param, damit der User nach dem Login wieder dorthin kommt, wo
 * er hin wollte.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { SessionSupersededBanner } from "~/features/auth/SessionSupersededBanner";
import { authClient } from "~/lib/auth-client";

/**
 * Profil-Felder, die beim ersten Login Pflicht sind. Wir prüfen das im
 * `_auth`-Guard und routen den User andernfalls auf `/setup`. Die
 * Setup-Route selbst muss bypassed werden, sonst Endlos-Redirect.
 */
async function needsProfileSetup(): Promise<boolean> {
  try {
    const res = await fetch("/api/users/me");
    if (!res.ok) return false;
    const me = (await res.json()) as {
      profile?: { realFirstName?: string | null; realLastName?: string | null };
    };
    const fn = me.profile?.realFirstName?.trim() ?? "";
    const ln = me.profile?.realLastName?.trim() ?? "";
    return fn.length === 0 || ln.length === 0;
  } catch {
    // Bei Netzfehler nicht blocken — der User kommt sonst nie zur Lobby,
    // wenn die API kurz hustet.
    return false;
  }
}

export const Route = createFileRoute("/_auth")({
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    // Nur bei BESTÄTIGT fehlender Session zum Login. Ein transienter Fehler
    // (z.B. 429 Rate-Limit oder Netz-Hänger) liefert ebenfalls keinen User,
    // darf aber NICHT ausloggen — sonst fliegt man bei einem Anfrage-Schwall
    // (mehrere Spieler hinter einer IP) fälschlich raus.
    if (!session.data?.user && !session.error) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
    // Setup-Pflicht: Vor- und Nachname müssen einmalig gesetzt werden.
    // Bypass für die Setup-Route selbst, sonst wäre der Redirect zirkulär.
    const isSetupRoute = location.pathname.startsWith("/setup");
    if (!isSetupRoute && (await needsProfileSetup())) {
      throw redirect({ to: "/setup" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <>
      <SessionSupersededBanner />
      <Outlet />
    </>
  );
}
