/**
 * Pathless Layout-Route für anonyme Bereiche (Login, Register, Verify-Hinweis).
 *
 * Falls bereits eine Session besteht, wird der User direkt in die Lobby
 * weitergeleitet — niemand soll versehentlich auf der Login-Seite landen,
 * obwohl er schon eingeloggt ist.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/_public")({
  beforeLoad: async () => {
    // `getSession` (Promise-Version) gibt uns die aktuelle Server-Sicht;
    // wenn der User schon eingeloggt ist, redirecten wir.
    const session = await authClient.getSession();
    if (session.data?.user) {
      throw redirect({ to: "/lobby" });
    }
  },
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <div className="max-w-md mx-auto">
      <Outlet />
    </div>
  );
}
