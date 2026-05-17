/**
 * Live-Liste aller offenen Tische.
 *
 * **Daten-Strategie**:
 *   - Initial-Fetch über REST (TanStack Query, key `["lobby", "list"]`).
 *   - WS-Subscribe via `useLobbyListEvents`: bei jedem `lobby:tables-
 *     updated` triggern wir ein `invalidateQueries` → React Query
 *     refetched die Liste.
 *   - Refetch-on-Window-Focus ist global aus; das WS-Push-Pattern reicht.
 *
 * **Beitritts-Aktionen**: pro Tisch ein Button — je nach `joinMode`
 * unterschiedliche Beschriftung. „Beitreten" / „Anfrage stellen" /
 * „Nur per Einladung". Wenn der User dort sitzt → „Wieder rein".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { api, ApiError } from "~/lib/api";
import { useSession } from "~/lib/auth-client";
import { useLobbyListEvents } from "~/lib/ws";
import type { JoinResult, TableListEntry } from "./types";

interface ListResponse {
  tables: TableListEntry[];
}

export function LobbyList() {
  const { data: session } = useSession();
  const myUserId = session?.user?.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isPending, error } = useQuery<ListResponse>({
    queryKey: ["lobby", "list"],
    queryFn: () => api<ListResponse>("/api/lobby/tables"),
  });

  // Live-Push: bei jedem Lobby-Event refetchen wir die Liste. Das ist
  // einfach und richtig — der Payload ist eh nur ein „reason".
  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
  }, [queryClient]);
  useLobbyListEvents(refetch);

  const joinMutation = useMutation({
    mutationFn: (tableId: string) =>
      api<JoinResult>(`/api/lobby/tables/${tableId}/join`, { method: "POST" }),
    onSuccess: (result, tableId) => {
      if (result.kind === "seated" || result.kind === "invite-used") {
        void navigate({ to: "/table/$id", params: { id: tableId } });
      }
      // request-pending: bleibt in der Lobby; refetch zeigt den Pending-Tag.
      queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
    },
  });

  if (isPending) {
    return <p className="text-stone-500">Lade Tische …</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-rose-700">
        Konnte Lobby nicht laden: {error.message}
      </p>
    );
  }

  const tables = data?.tables ?? [];
  if (tables.length === 0) {
    return (
      <p className="text-stone-500">
        Keine offenen Tische. Öffne den ersten mit „Tisch öffnen" oben rechts.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-stone-200 border border-stone-200 rounded">
      {tables.map((t) => (
        <li key={t.id} className="px-4 py-3 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <strong className="text-stone-900">{t.ownerName}</strong>
              <ModeBadge mode={t.joinMode} />
              <StatusBadge status={t.status} />
            </div>
            <div className="text-sm text-stone-500">
              Sitze: {t.seatsTaken}/4 · KI: {t.aiSeatType} ·{" "}
              {t.autoFillSeconds === null ? "kein Auto-Fill" : `Auto-Fill ${t.autoFillSeconds}s`}
              {" · "}
              Re-Match: {t.restartMode === "WELI" ? "Welli" : "Sieger gibt"}
            </div>
          </div>
          <JoinButton
            table={t}
            isMine={t.ownerId === myUserId}
            isPending={joinMutation.isPending && joinMutation.variables === t.id}
            onJoin={() => joinMutation.mutate(t.id)}
            onOpen={() => navigate({ to: "/table/$id", params: { id: t.id } })}
            joinError={joinMutation.error}
          />
        </li>
      ))}
    </ul>
  );
}

function JoinButton(props: {
  table: TableListEntry;
  isMine: boolean;
  isPending: boolean;
  onJoin: () => void;
  onOpen: () => void;
  joinError: Error | null;
}) {
  const { table, isMine, isPending, onJoin, onOpen, joinError } = props;
  const failedHere = joinError instanceof ApiError ? joinError.message : null;

  // Eigener Tisch → direkt rein.
  if (isMine) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-700"
      >
        Mein Tisch
      </button>
    );
  }

  // Schon pending-Anfrage → Hinweis statt Button.
  if (table.hasPendingRequest) {
    return <span className="text-sm text-stone-500">Anfrage läuft</span>;
  }

  // Status entscheidet, ob überhaupt beitretbar.
  if (table.status === "IN_GAME") {
    return <span className="text-sm text-stone-400">Spiel läuft</span>;
  }
  if (table.status === "CLOSED") {
    return <span className="text-sm text-stone-400">Geschlossen</span>;
  }

  const label =
    table.joinMode === "REQUEST"
      ? "Anfrage stellen"
      : table.joinMode === "INVITE"
        ? "Nur per Einladung"
        : "Beitreten";
  const disabled = table.joinMode === "INVITE" || isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onJoin}
        disabled={disabled}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "…" : label}
      </button>
      {failedHere && <span className="text-xs text-rose-700">{failedHere}</span>}
    </div>
  );
}

function ModeBadge({ mode }: { mode: "OPEN" | "REQUEST" | "INVITE" }) {
  const labels = { OPEN: "offen", REQUEST: "auf Anfrage", INVITE: "nur Einladung" };
  const colors = {
    OPEN: "bg-emerald-100 text-emerald-800",
    REQUEST: "bg-amber-100 text-amber-800",
    INVITE: "bg-violet-100 text-violet-800",
  };
  return <span className={`rounded px-1.5 py-0.5 text-xs ${colors[mode]}`}>{labels[mode]}</span>;
}

function StatusBadge({ status }: { status: "WAITING" | "IN_GAME" | "POST_GAME" | "CLOSED" }) {
  if (status === "WAITING") return null; // Default — nicht zeigen
  const labels = {
    WAITING: "wartet",
    IN_GAME: "läuft",
    POST_GAME: "Re-Match-Vote",
    CLOSED: "geschlossen",
  };
  return (
    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
      {labels[status]}
    </span>
  );
}
