/**
 * Admin-Layout-Route. Pathless (kein `/_admin/...` in der URL — nur
 * `/admin/...`), erbt den Auth-Guard von `_auth.tsx` und ergänzt eine
 * ADMIN-Role-Prüfung über GET /api/users/me.
 *
 * Bei fehlender ADMIN-Rolle → Redirect zur Lobby.
 */
import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

import { api } from "~/lib/api";
import type { MeProfileResponse } from "~/features/admin/types";

export const Route = createFileRoute("/_auth/admin")({
  beforeLoad: async () => {
    try {
      // GET /api/users/me liefert die DB-Rolle (Better-Auth-Session
      // allein hat sie nicht).
      const me = await api<MeProfileResponse>("/api/users/me");
      if (me.role !== "ADMIN") {
        throw redirect({ to: "/lobby" });
      }
    } catch (err) {
      // ApiError oder Network-Error → in die Lobby zurück
      if (err instanceof Error && err.name !== "ApiError") {
        throw redirect({ to: "/lobby" });
      }
      throw err;
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3 border-b border-stone-200 pb-2">
        <h1 className="text-2xl font-bold">Admin</h1>
        <nav className="flex gap-3 text-sm ml-4">
          <Link
            to="/admin"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            Dashboard
          </Link>
          <Link
            to="/admin/smtp"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            SMTP
          </Link>
          <Link
            to="/admin/users"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            Users
          </Link>
          <Link
            to="/admin/blocklist"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            Blocklist
          </Link>
          <Link
            to="/admin/banned-words"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            Wortfilter
          </Link>
          <Link
            to="/admin/audit"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            Audit-Log
          </Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
