import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  return (
    <section className="space-y-4">
      <p className="text-stone-600">
        Verwaltungsbereich. Tools für SMTP-Settings, User-Management, Blocklist, Chat-Wortfilter und
        Audit-Log.
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          to="/admin/smtp"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>SMTP-Settings</strong>
          <p className="text-sm text-stone-500">
            Mailversand-Konfiguration. Passwort wird AES-256-GCM-verschlüsselt.
          </p>
        </Link>
        <Link
          to="/admin/users"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>User-Management</strong>
          <p className="text-sm text-stone-500">Rollen, Block/Unblock, Filter nach Status.</p>
        </Link>
        <Link
          to="/admin/blocklist"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>Blocklist</strong>
          <p className="text-sm text-stone-500">E-Mail-Pattern und -Domains für Register-Sperre.</p>
        </Link>
        <Link
          to="/admin/banned-words"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>Chat-Wortfilter</strong>
          <p className="text-sm text-stone-500">
            Wortliste, die in Chat-Nachrichten durch <code>***</code> ersetzt wird.
          </p>
        </Link>
        <Link
          to="/admin/audit"
          className="block rounded border border-stone-200 px-4 py-3 hover:bg-stone-50"
        >
          <strong>Audit-Log</strong>
          <p className="text-sm text-stone-500">
            Alle sicherheitsrelevanten Aktionen (auth, lobby, admin, …).
          </p>
        </Link>
      </ul>
    </section>
  );
}
