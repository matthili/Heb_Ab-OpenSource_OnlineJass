/**
 * Tisch-Detail-View.
 *
 * Owner sieht alle Aktionen (Start, Settings, Approve/Deny, Invite,
 * Leave); andere Spieler sehen Sitze + Leave. Sobald das Spiel
 * gestartet ist (`status === "IN_GAME"`), würde hier eigentlich die
 * Tisch-Spielfläche stehen — die kommt aber erst mit M7-D. Für M7-C
 * zeigen wir nur einen Hinweis und einen Link zum (noch nicht
 * existenten) `/game/$id`-Pfad.
 *
 * Live-Updates: `useTableStateEvents` schreibt eingehende `lobby:
 * table-state`-Pushes in den React-Query-Cache, damit refetch unnötig
 * wird.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { BodenseeBoard } from "~/features/bodensee/BodenseeBoard";
import { BodenseeRematchPanel } from "~/features/bodensee/BodenseeRematchPanel";
import { useBodenseeView } from "~/features/bodensee/useBodenseeView";
import { ChatPanel } from "~/features/chat/ChatPanel";
import { aiName } from "~/features/game/aiNames";
import { DisconnectOverlay } from "~/features/game/DisconnectOverlay";
import { GameBoard } from "~/features/game/GameBoard";
import { MatchOverOverlay } from "~/features/game/MatchOverOverlay";
import { RematchPanel } from "~/features/game/RematchPanel";
import { useGameView } from "~/features/game/useGameView";
import { api, ApiError } from "~/lib/api";
import { useSession } from "~/lib/auth-client";
import { getLobbySocket } from "~/lib/ws";
import { useTableStateEvents } from "~/lib/ws";
import { LeaveTableConfirm } from "./LeaveTableConfirm";
import type { TableDetailView } from "./types";

interface Props {
  tableId: string;
}

export function TableDetail({ tableId }: Props) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const myUserId = session?.user?.id;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // **Stabil halten (useMemo):** `queryKey` fließt in `onWsUpdate` (useCallback)
  // und in zwei Effect-Dependency-Listen. Ein bei jedem Render neu erzeugtes
  // Array würde diese Effects bei jedem Render neu laufen lassen — und
  // `useTableStateEvents` feuert im Cleanup/Setup `lobby:(un)subscribe-table`.
  // Das ergäbe (wie früher der Chat-Hook) einen WS-Event-Sturm, der den
  // Rate-Limiter auslöst und den Socket trennt.
  const queryKey = useMemo(() => ["lobby", "table", tableId] as const, [tableId]);
  const { data, isPending, error } = useQuery<TableDetailView>({
    queryKey,
    queryFn: () => api<TableDetailView>(`/api/lobby/tables/${tableId}`),
  });

  // WS-Updates direkt in den Cache schreiben — kein Refetch nötig.
  const onWsUpdate = useCallback(
    (view: unknown) => {
      if (view === null) {
        // Tisch geschlossen → zurück in die Lobby.
        void navigate({ to: "/lobby" });
        return;
      }
      queryClient.setQueryData(queryKey, view as TableDetailView);
    },
    [queryClient, queryKey, navigate]
  );
  useTableStateEvents(tableId, onWsUpdate);

  // **Game-Ende-Trigger**: Wenn das Game per `game:ended` schließt, wechselt
  // der Tisch-Status backend-seitig auf POST_GAME (oder MATCH_OVER). Das
  // Lobby-WS-Event `lobby:table-state` kommt aber NICHT automatisch
  // hinterher — also stoßen wir hier den Refetch der Tisch-Query an,
  // damit das `RematchPanel` und die Owner-Aktionen sofort umschalten.
  useEffect(() => {
    const sock = getLobbySocket();
    const onEnded = () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["lobby", "my-tables"] });
    };
    sock.on("game:ended", onEnded);
    sock.on("bodensee:ended", onEnded);
    return () => {
      sock.off("game:ended", onEnded);
      sock.off("bodensee:ended", onEnded);
    };
  }, [queryClient, queryKey]);

  if (isPending) return <p className="text-stone-500">{t("lobby.tableDetail.loading")}</p>;
  if (error) {
    return (
      <p role="alert" className="text-rose-700">
        {t("lobby.tableDetail.loadError", { message: error.message })}
      </p>
    );
  }
  if (!data) return null;
  const isOwner = data.ownerId === myUserId;
  const amIAtTable = data.seats.some((s) => s.user?.id === myUserId);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">
            {t("lobby.tableDetail.heading", { name: data.ownerName })}
            <span className="text-jass-inkSoft font-semibold">
              {" — "}
              {t(`lobby.openTable.variant.${data.variant}.title`)}
            </span>
          </h1>
          <StatusBadge status={data.status} />
        </div>
        <p className="text-sm text-stone-500">
          {t("lobby.tableDetail.meta", {
            mode: data.joinMode,
            ai: data.aiSeatType,
            restart:
              data.restartMode === "WELI" ? t("lobby.restartWeli") : t("lobby.restartSiegerGibt"),
            target: data.targetScore,
          })}
        </p>
      </header>

      <CumulativeScoreBar table={data} />

      <SeatRow seats={data.seats} nameSeed={data.id} />

      {data.currentGameId &&
        (data.status === "IN_GAME" ||
          data.status === "POST_GAME" ||
          data.status === "MATCH_OVER") &&
        (data.variant === "BODENSEE_2P" ? (
          <BodenseeGameSection
            gameId={data.currentGameId}
            tableSeats={data.seats}
            isAtTable={amIAtTable}
            tableStatus={data.status}
            nameSeed={data.id}
          />
        ) : (
          <GameSection
            gameId={data.currentGameId}
            tableSeats={data.seats}
            isAtTable={amIAtTable}
            tableStatus={data.status}
            isFirstGame={data.cumulativeScores.every((s) => s === 0)}
            cumulativeScores={data.cumulativeScores}
            targetScore={data.targetScore}
            nameSeed={data.id}
          />
        ))}

      {isOwner ? (
        <OwnerPanel table={data} queryKey={queryKey} />
      ) : amIAtTable ? (
        <PlayerPanel tableId={tableId} tableStatus={data.status} queryKey={queryKey} />
      ) : null}
    </section>
  );
}

function SeatRow({ seats, nameSeed }: { seats: TableDetailView["seats"]; nameSeed: string }) {
  const { t } = useTranslation();
  return (
    <ul
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      aria-label={t("lobby.tableDetail.seatsLabel")}
    >
      {seats.map((s) => (
        <li
          key={s.seat}
          className="rounded border border-stone-200 px-3 py-2 flex items-center gap-3"
        >
          <span className="rounded bg-stone-100 text-stone-600 px-2 py-0.5 text-xs">
            {t("lobby.tableDetail.seat", { n: s.seat })}
          </span>
          {s.isEmpty ? (
            <span className="text-stone-400 text-sm italic">
              {t("lobby.tableDetail.seatEmpty")}
            </span>
          ) : s.user ? (
            <span className="font-medium">{s.user.name}</span>
          ) : s.aiSeatType ? (
            <span className="text-stone-600">{aiName(`${nameSeed}:${s.seat}`, s.aiSeatType)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: TableDetailView["status"] }) {
  const { t } = useTranslation();
  const colorClass =
    status === "MATCH_OVER"
      ? "bg-jass-yellow text-jass-ink border border-jass-yellowDark"
      : "bg-stone-100 text-stone-600";
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${colorClass}`}>
      {t(`lobby.tableDetail.status.${status}`)}
    </span>
  );
}

/**
 * Kumulativer Score-Balken: zeigt den Partie-Fortschritt zum Punkteziel.
 * Bei Kreuz-Jass 2 Team-Zeilen, bei Solo-Jass 4 Spieler-Zeilen. Wer das
 * Ziel erreicht, wird goldgelb hervorgehoben.
 */
function CumulativeScoreBar({ table }: { table: TableDetailView }) {
  const { t } = useTranslation();
  const scores = table.cumulativeScores;
  const target = table.targetScore;
  // Falls noch kein Game gespielt wurde: Balken weglassen.
  if (scores.every((s) => s === 0)) return null;
  const isPerPlayer = table.variant === "SOLO_4P" || table.variant === "BODENSEE_2P";
  const winner = scores.findIndex((s) => s >= target); // -1 = noch offen

  // Zeilen-Label: bei Solo/Bodensee der Spielername (Konto je Sitz), bei
  // Kreuz die Team-Bezeichnung mit den zugehörigen Sitzen.
  const labelFor = (teamIdx: number): string => {
    if (isPerPlayer) {
      const seat = table.seats.find((s) => s.seat === teamIdx);
      if (seat?.user) return seat.user.name;
      if (seat?.aiSeatType) {
        return aiName(`${table.id}:${teamIdx}`, seat.aiSeatType);
      }
      return t("lobby.tableDetail.teamLabel", { n: teamIdx + 1 });
    }
    return teamIdx === 0 ? t("lobby.tableDetail.team0") : t("lobby.tableDetail.team1");
  };

  return (
    <section
      className="rounded-lg border border-jass-paperEdge bg-jass-paper p-3 space-y-2"
      aria-label={t("lobby.tableDetail.scoreLabel")}
    >
      <div className="flex items-baseline justify-between text-sm text-jass-inkSoft">
        <span>
          <Trans
            i18nKey="lobby.tableDetail.scoreProgress"
            values={{ target }}
            components={{ strong: <strong className="text-jass-ink" /> }}
          />
        </span>
        {winner >= 0 && (
          <span className="text-jass-yellowDark font-semibold">
            {t("lobby.tableDetail.scoreWinner", { name: labelFor(winner) })}
          </span>
        )}
      </div>
      {scores.map((score, i) => (
        <ScoreRow
          key={i}
          label={labelFor(i)}
          score={score}
          pct={Math.min(100, Math.round((score / target) * 100))}
          highlight={winner === i}
        />
      ))}
    </section>
  );
}

function ScoreRow({
  label,
  score,
  pct,
  highlight,
}: {
  label: string;
  score: number;
  pct: number;
  highlight: boolean;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-jass-ink">{label}</span>
        <span className={highlight ? "font-bold text-jass-yellowDark" : "text-jass-ink"}>
          {score}
        </span>
      </div>
      <div className="h-2 rounded-full bg-jass-cream overflow-hidden">
        <div
          className={highlight ? "h-full bg-jass-yellow" : "h-full bg-jass-brownDark"}
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function OwnerPanel(props: { table: TableDetailView; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const { table, queryKey } = props;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmLeave, setConfirmLeave] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const startMut = useMutation({
    mutationFn: () =>
      api<{ gameId: string }>(`/api/lobby/tables/${table.id}/start`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const newMatchMut = useMutation({
    mutationFn: () =>
      api<{ tableId: string }>(`/api/lobby/tables/${table.id}/new-match`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const leaveMut = useMutation({
    mutationFn: () =>
      api<{ tableClosed: boolean }>(`/api/lobby/tables/${table.id}/leave`, { method: "POST" }),
    onSuccess: () => {
      // Lobby-Caches sofort entwerten, sonst sieht der User in der
      // Lobby seinen gerade verlassenen Tisch noch im „Mein aktiver
      // Tisch"-Banner (staleTime 10s).
      queryClient.invalidateQueries({ queryKey: ["lobby", "my-tables"] });
      queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
      setConfirmLeave(false);
      void navigate({ to: "/lobby" });
    },
    onError: (err: unknown) => {
      // **Robust-Fallback**: wenn der Server 404/409 zurückgibt, ist der
      // User effektiv nicht mehr am Tisch (entweder existiert er nicht
      // mehr oder ist schon geschlossen). User-Intent „Tisch verlassen"
      // ist damit erfüllt → ab zur Lobby. Andere Fehler werfen wir in
      // der Konsole, damit der Test-Pfad nicht still scheitert.
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        queryClient.invalidateQueries({ queryKey: ["lobby", "my-tables"] });
        queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
        setConfirmLeave(false);
        void navigate({ to: "/lobby" });
        return;
      }
      // eslint-disable-next-line no-console
      console.error("Leave-Table-Fehler:", err);
    },
  });
  const approveMut = useMutation({
    mutationFn: (reqId: string) =>
      api(`/api/lobby/tables/${table.id}/join-requests/${reqId}/approve`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const denyMut = useMutation({
    mutationFn: (reqId: string) =>
      api(`/api/lobby/tables/${table.id}/join-requests/${reqId}/deny`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const startError = startMut.error instanceof ApiError ? startMut.error.message : null;

  return (
    <div className="space-y-4 border-t border-stone-200 pt-4">
      <h2 className="font-semibold text-stone-700">{t("lobby.tableDetail.ownerActions")}</h2>

      <div className="flex gap-2 flex-wrap">
        {table.status === "WAITING" && (
          <button
            type="button"
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending}
            className="rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {startMut.isPending
              ? t("lobby.tableDetail.starting")
              : t("lobby.tableDetail.startGame")}
          </button>
        )}
        {table.status === "MATCH_OVER" && (
          <button
            type="button"
            onClick={() => newMatchMut.mutate()}
            disabled={newMatchMut.isPending}
            className="btn-jass-primary disabled:opacity-50"
          >
            {newMatchMut.isPending
              ? t("lobby.tableDetail.startingMatch")
              : t("lobby.tableDetail.newMatch")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirmLeave(true)}
          disabled={leaveMut.isPending}
          className="rounded border border-stone-300 px-4 py-2 text-stone-700 hover:bg-stone-100"
        >
          {t("lobby.tableDetail.leaveTable")}
        </button>
      </div>
      <LeaveTableConfirm
        open={confirmLeave}
        tableStatus={table.status}
        pending={leaveMut.isPending}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => leaveMut.mutate()}
      />
      {startError && (
        <p role="alert" className="text-sm text-rose-700">
          {startError}
        </p>
      )}

      {table.joinRequests && table.joinRequests.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-stone-700">
            {t("lobby.tableDetail.requests", { count: table.joinRequests.length })}
          </h3>
          <ul className="space-y-1">
            {table.joinRequests.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded border border-stone-200 px-3 py-2"
              >
                <span className="flex-1 text-sm">{r.userName}</span>
                <button
                  type="button"
                  onClick={() => approveMut.mutate(r.id)}
                  disabled={approveMut.isPending}
                  className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-500"
                >
                  {t("lobby.tableDetail.approve")}
                </button>
                <button
                  type="button"
                  onClick={() => denyMut.mutate(r.id)}
                  disabled={denyMut.isPending}
                  className="rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100"
                >
                  {t("lobby.tableDetail.deny")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {table.status !== "CLOSED" && <InviteForm tableId={table.id} queryKey={queryKey} />}

      {table.invites && table.invites.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-stone-700">
            {t("lobby.tableDetail.openInvites", { count: table.invites.length })}
          </h3>
          <ul className="space-y-1">
            {table.invites.map((i) => (
              <InviteRow
                key={i.id}
                inviteId={i.id}
                tableId={table.id}
                inviteeName={i.inviteeName}
                queryKey={queryKey}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Eingabe-Formular zum Einladen eines bestehenden Users per
 * `displayName`. Backend resolved den Namen zu User-ID. Bei
 * Erfolg → Tisch-View invalidaten, die neue Invite taucht in der Liste auf.
 */
function InviteForm({ tableId, queryKey }: { tableId: string; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const inviteMut = useMutation({
    mutationFn: (inviteeName: string) =>
      api<{ inviteId: string; inviteeUserId: string }>(`/api/lobby/tables/${tableId}/invites`, {
        method: "POST",
        body: { inviteeName },
      }),
    onSuccess: (_data, inviteeName) => {
      setSuccess(t("lobby.tableDetail.inviteSent", { name: inviteeName }));
      setName("");
      queryClient.invalidateQueries({ queryKey });
      // Erfolgs-Meldung auto-versteckt nach 4 s.
      setTimeout(() => setSuccess(null), 4_000);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : t("lobby.tableDetail.inviteFailed"));
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("lobby.tableDetail.inviteEnterName"));
      return;
    }
    inviteMut.mutate(trimmed);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-2 border-t border-stone-200 pt-3"
      aria-label={t("lobby.tableDetail.invitePlayer")}
    >
      <label className="block">
        <span className="block text-sm font-medium text-stone-700 mb-1">
          {t("lobby.tableDetail.invitePlayer")}
        </span>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("lobby.tableDetail.inviteNamePlaceholder")}
            className="flex-1 rounded border border-stone-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            type="submit"
            disabled={inviteMut.isPending}
            className="rounded bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {inviteMut.isPending ? "…" : t("lobby.tableDetail.inviteSubmit")}
          </button>
        </div>
      </label>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-emerald-700">
          {success}
        </p>
      )}
    </form>
  );
}

/**
 * Eine offene Einladung in der Liste — mit Zurückziehen-Button.
 */
function InviteRow({
  inviteId,
  tableId,
  inviteeName,
  queryKey,
}: {
  inviteId: string;
  tableId: string;
  inviteeName: string;
  queryKey: readonly unknown[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const cancelMut = useMutation({
    mutationFn: () =>
      api(`/api/lobby/tables/${tableId}/invites/${inviteId}/cancel`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  return (
    <li className="flex items-center gap-3 rounded border border-stone-200 px-3 py-2">
      <span className="flex-1 text-sm">{inviteeName}</span>
      <button
        type="button"
        onClick={() => cancelMut.mutate()}
        disabled={cancelMut.isPending}
        className="rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100"
      >
        {t("lobby.tableDetail.withdrawInvite")}
      </button>
    </li>
  );
}

function PlayerPanel({
  tableId,
  tableStatus,
  queryKey,
}: {
  tableId: string;
  tableStatus: TableDetailView["status"];
  queryKey: readonly unknown[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leaveMut = useMutation({
    mutationFn: () => api(`/api/lobby/tables/${tableId}/leave`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["lobby", "my-tables"] });
      queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
      setConfirmLeave(false);
      void navigate({ to: "/lobby" });
    },
    onError: (err: unknown) => {
      // Siehe OwnerPanel-Pendant: 404 / 409 = User ist eh nicht (mehr) am
      // Tisch, also Intent erfüllt → Lobby.
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ["lobby", "my-tables"] });
        queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
        setConfirmLeave(false);
        void navigate({ to: "/lobby" });
        return;
      }
      // eslint-disable-next-line no-console
      console.error("Leave-Table-Fehler:", err);
    },
  });
  return (
    <div className="space-y-2 border-t border-stone-200 pt-4">
      <button
        type="button"
        onClick={() => setConfirmLeave(true)}
        disabled={leaveMut.isPending}
        className="rounded border border-stone-300 px-4 py-2 text-stone-700 hover:bg-stone-100"
      >
        {t("lobby.tableDetail.leaveTable")}
      </button>
      <LeaveTableConfirm
        open={confirmLeave}
        tableStatus={tableStatus}
        pending={leaveMut.isPending}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => leaveMut.mutate()}
      />
    </div>
  );
}

/**
 * Game-Section: Spielfläche + Re-Match-Panel je nach Tisch-Status.
 *
 * Nur wer am Tisch sitzt (`isAtTable`), darf das Spiel sehen; Beobachter
 * würden sonst eine 404 von /api/games/:id bekommen. Falls Spectator-
 * Modus in M11 kommt, machen wir das hier locker.
 */
function GameSection({
  gameId,
  tableSeats,
  isAtTable,
  tableStatus,
  isFirstGame,
  cumulativeScores,
  targetScore,
  nameSeed,
}: {
  gameId: string;
  tableSeats: TableDetailView["seats"];
  isAtTable: boolean;
  tableStatus: TableDetailView["status"];
  /** Erstes Spiel der Partie → volle Cinematic. Sonst Kurz-Cinematic. */
  isFirstGame: boolean;
  /** Kumulative Partie-Stände (2 bei Kreuz, 4 bei Solo) für RematchPanel. */
  cumulativeScores: readonly number[];
  targetScore: number;
  /** Seed für stabile KI-Namen — die Tisch-ID (über die ganze Partie konstant). */
  nameSeed: string;
}) {
  const { t } = useTranslation();
  const {
    view,
    error,
    movePending,
    announcePending,
    cutPending,
    weisenPending,
    playCard,
    announce,
    cut,
    announceStoeck,
    clickWeisen,
    submitWeisen,
  } = useGameView(isAtTable ? gameId : null);

  if (!isAtTable) {
    return (
      <div className="rounded border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
        {t("lobby.tableDetail.gameRunningNotAtTable")}
      </div>
    );
  }

  if (!view) {
    return <p className="text-stone-500">{t("lobby.tableDetail.loadingGame")}</p>;
  }

  return (
    <section className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4">
      {/* `relative` macht den GameBoard-Container zur Verankerung für das
          DisconnectOverlay (absolute inset-0). Der Chat-Bereich rechts
          bleibt außerhalb dieses Containers und damit voll bedienbar —
          User können auch im Disconnect-Wartemodus tippen. */}
      <div className="space-y-4 relative">
        <GameBoard
          view={view}
          seats={tableSeats}
          mySeat={view.mySeat}
          movePending={movePending}
          announcePending={announcePending}
          cutPending={cutPending}
          weisenPending={weisenPending}
          error={error}
          dealCinematicMode={isFirstGame ? "full" : "short"}
          nameSeed={nameSeed}
          onPlayCard={playCard}
          onAnnounce={announce}
          onCut={cut}
          onAnnounceStoeck={announceStoeck}
          onClickWeisen={clickWeisen}
          onSubmitWeisen={submitWeisen}
        />
        {tableStatus === "POST_GAME" && view.status === "finished" && (
          <RematchPanel
            gameId={gameId}
            finalScore={view.finalScore}
            cumulativeScores={cumulativeScores}
            targetScore={targetScore}
            seats={tableSeats}
            mySeat={view.mySeat}
            nameSeed={nameSeed}
          />
        )}
        {tableStatus === "MATCH_OVER" && view.status === "finished" && (
          <MatchOverOverlay
            gameId={gameId}
            cumulativeScores={cumulativeScores}
            seats={tableSeats}
            mySeat={view.mySeat}
            nameSeed={nameSeed}
          />
        )}
        <DisconnectOverlay
          gameId={gameId}
          seats={tableSeats}
          mySeat={view.mySeat}
          nameSeed={nameSeed}
        />
      </div>
      <ChatPanel channelKey={`game:${gameId}`} title={t("lobby.tableDetail.tableChat")} />
    </section>
  );
}

/**
 * Game-Section für Bodensee-Jass (2 Spieler). Eigener WS-Pfad
 * (`useBodenseeView`) und eine eigene Spielfläche (`BodenseeBoard`).
 * Re-Match und Disconnect-Overlay sind hier noch nicht angebunden —
 * der Tisch landet nach Spielende in POST_GAME, von wo der Owner über
 * „Neue Partie" bzw. die Lobby weitermacht.
 */
function BodenseeGameSection({
  gameId,
  tableSeats,
  isAtTable,
  tableStatus,
  nameSeed,
}: {
  gameId: string;
  tableSeats: TableDetailView["seats"];
  isAtTable: boolean;
  tableStatus: TableDetailView["status"];
  /** Seed für stabile KI-Namen — die Tisch-ID. */
  nameSeed: string;
}) {
  const { t } = useTranslation();
  const { view, error, movePending, announcePending, playCard, announce } = useBodenseeView(
    isAtTable ? gameId : null
  );

  if (!isAtTable) {
    return (
      <div className="rounded border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
        {t("lobby.tableDetail.gameRunningNotAtTable")}
      </div>
    );
  }

  if (!view) {
    return <p className="text-stone-500">{t("lobby.tableDetail.loadingGame")}</p>;
  }

  return (
    <section className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4">
      <div className="space-y-4">
        <BodenseeBoard
          view={view}
          seats={tableSeats}
          movePending={movePending}
          announcePending={announcePending}
          error={error}
          nameSeed={nameSeed}
          onPlayCard={playCard}
          onAnnounce={announce}
        />
        {tableStatus === "POST_GAME" && view.status === "finished" && (
          <BodenseeRematchPanel gameId={gameId} />
        )}
      </div>
      <ChatPanel channelKey={`game:${gameId}`} title={t("lobby.tableDetail.tableChat")} />
    </section>
  );
}
