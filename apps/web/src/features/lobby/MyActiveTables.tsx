/**
 * „Mein aktiver Tisch"-Banner in der Lobby.
 *
 * Liefert dem User einen prominenten Rückkehr-Link zu jedem Tisch, an dem
 * er gerade sitzt (oder den er besitzt) und der nicht CLOSED ist. Damit
 * findet er nach einer Navigation (Profil-Klick, Versehentliches
 * „Lobby"-Tab) wieder zurück, ohne den Tisch erst suchen zu müssen.
 *
 * Empty-State: kein Banner → die normale Tisch-Liste darunter rückt auf.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "~/lib/api";

import type { TableListEntry } from "./types";

export function MyActiveTables() {
  const { data } = useQuery<{ tables: TableListEntry[] }>({
    queryKey: ["lobby", "my-tables"],
    queryFn: () => api<{ tables: TableListEntry[] }>("/api/lobby/my-tables"),
    // Re-fetch häufig genug, damit ein frisch-erstellter Tisch sofort
    // hier erscheint. 10 s ist genug — die Lobby-WS sendet ohnehin
    // Push-Updates über das gleiche Query.
    staleTime: 10_000,
  });
  const tables = data?.tables ?? [];
  if (tables.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-jass-yellow bg-jass-cream p-3 shadow-sm"
      aria-label="Mein aktiver Tisch"
    >
      <h2 className="text-sm font-semibold text-jass-ink mb-2">
        {tables.length === 1 ? "Dein aktiver Tisch" : "Deine aktiven Tische"}
      </h2>
      <ul className="space-y-1.5">
        {tables.map((t) => (
          <li key={t.id} className="flex items-center gap-3 text-sm">
            <StatusPill status={t.status} />
            <span className="text-jass-inkSoft">
              <span className="text-jass-ink">#{t.id.slice(-6)}</span>
              {" · "}
              Owner: {t.ownerName}
              {" · "}
              Sitze: {t.seatsTaken}/4
            </span>
            <Link
              to="/table/$id"
              params={{ id: t.id }}
              className="ml-auto rounded bg-jass-ink px-3 py-1 text-xs text-jass-cream hover:bg-jass-brownDark"
            >
              Zum Tisch →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusPill({ status }: { status: TableListEntry["status"] }) {
  const map: Record<TableListEntry["status"], { label: string; cls: string }> = {
    WAITING: { label: "wartet", cls: "bg-jass-paper text-jass-inkSoft" },
    IN_GAME: { label: "Spiel läuft", cls: "bg-jass-green text-jass-cream" },
    POST_GAME: { label: "Re-Match", cls: "bg-jass-yellow text-jass-ink" },
    CLOSED: { label: "geschlossen", cls: "bg-jass-paperEdge text-jass-inkSoft" },
  };
  const { label, cls } = map[status];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
