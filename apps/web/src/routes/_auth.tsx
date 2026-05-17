/**
 * Pathless Layout-Route für eingeloggte Bereiche (Lobby, Tisch, Profile).
 *
 * Auth-Guard: ohne Session → Redirect auf `/login` mit Rück-URL als
 * Query-Param, damit der User nach dem Login wieder dorthin kommt, wo
 * er hin wollte.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authClient } from "~/lib/auth-client";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    if (!session.data?.user) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return <Outlet />;
}
