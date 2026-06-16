/**
 * Admin-Layout-Route. Pathless (kein `/_admin/...` in der URL — nur
 * `/admin/...`), erbt den Auth-Guard von `_auth.tsx` und ergänzt eine
 * ADMIN-Role-Prüfung über GET /api/users/me.
 *
 * Bei fehlender ADMIN-Rolle → Redirect zur Lobby.
 */
import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3 border-b border-stone-200 pb-2">
        <h1 className="text-2xl font-bold">{t("admin.layout.title")}</h1>
        <nav className="flex gap-3 text-sm ml-4">
          <Link
            to="/admin"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.dashboard")}
          </Link>
          <Link
            to="/admin/settings"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.settings")}
          </Link>
          <Link
            to="/admin/smtp"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.smtp")}
          </Link>
          <Link
            to="/admin/users"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.users")}
          </Link>
          <Link
            to="/admin/blocklist"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.blocklist")}
          </Link>
          <Link
            to="/admin/banned-words"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.bannedWords")}
          </Link>
          <Link
            to="/admin/audit"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.audit")}
          </Link>
          <Link
            to="/admin/reports"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.reports")}
          </Link>
          <Link
            to="/admin/tables"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.tables")}
          </Link>
          <Link
            to="/admin/quitters"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.quitters")}
          </Link>
          <Link
            to="/admin/system"
            activeProps={{ className: "font-semibold text-stone-900" }}
            inactiveProps={{ className: "text-stone-600 hover:text-stone-900" }}
          >
            {t("admin.layout.nav.system")}
          </Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
