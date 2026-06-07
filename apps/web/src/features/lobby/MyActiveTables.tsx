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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { api } from "~/lib/api";
import { useLobbyListEvents } from "~/lib/ws";

import type { TableListEntry } from "./types";

export function MyActiveTables() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useQuery<{ tables: TableListEntry[] }>({
    queryKey: ["lobby", "my-tables"],
    queryFn: () => api<{ tables: TableListEntry[] }>("/api/lobby/my-tables"),
    // Re-fetch häufig genug, damit ein frisch-erstellter Tisch sofort
    // hier erscheint. 10 s ist genug — die Lobby-WS sendet ohnehin
    // Push-Updates über das gleiche Query.
    staleTime: 10_000,
  });
  // Live-Refresh: bei jedem Lobby-Event (table-opened, seat-changed,
  // closed) invalidieren wir auch unsere „my-tables"-Query — sonst sieht
  // der User seinen gerade verlassenen Tisch noch bis zum nächsten
  // staleTime-Tick.
  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["lobby", "my-tables"] });
  }, [queryClient]);
  useLobbyListEvents(refetch);
  const tables = data?.tables ?? [];
  if (tables.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-jass-yellow bg-jass-cream p-3 shadow-sm"
      aria-label={t("lobby.myTables.label")}
    >
      <h2 className="text-sm font-semibold text-jass-ink mb-2">
        {tables.length === 1 ? t("lobby.myTables.headingOne") : t("lobby.myTables.headingMany")}
      </h2>
      <ul className="space-y-1.5">
        {tables.map((tbl) => (
          <li key={tbl.id} className="flex items-center gap-3 text-sm">
            <StatusPill status={tbl.status} />
            <span className="text-jass-inkSoft">
              <span className="text-jass-ink">#{tbl.id.slice(-6)}</span>
              {" · "}
              {t("lobby.myTables.owner", { name: tbl.ownerName })}
              {" · "}
              {t("lobby.myTables.seats", { taken: tbl.seatsTaken })}
            </span>
            <Link
              to="/table/$id"
              params={{ id: tbl.id }}
              className="ml-auto rounded bg-jass-ink px-3 py-1 text-xs text-jass-cream hover:opacity-90"
            >
              {t("lobby.myTables.goToTable")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusPill({ status }: { status: TableListEntry["status"] }) {
  const { t } = useTranslation();
  const clsMap: Record<TableListEntry["status"], string> = {
    WAITING: "bg-jass-paper text-jass-inkSoft",
    IN_GAME: "bg-jass-green text-jass-cream",
    POST_GAME: "bg-jass-yellow text-jass-ink",
    MATCH_OVER: "bg-jass-yellow text-jass-ink border border-jass-yellowDark",
    CLOSED: "bg-jass-paperEdge text-jass-inkSoft",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${clsMap[status]}`}>
      {t(`lobby.myTables.status.${status}`)}
    </span>
  );
}
