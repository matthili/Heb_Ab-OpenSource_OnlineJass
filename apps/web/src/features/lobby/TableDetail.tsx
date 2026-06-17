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
import { OpponentLeftDialog } from "~/features/bodensee/OpponentLeftDialog";
import { BodenseeRematchPanel } from "~/features/bodensee/BodenseeRematchPanel";
import { useBodenseeView } from "~/features/bodensee/useBodenseeView";
import { ChatPanel } from "~/features/chat/ChatPanel";
import { UserName } from "~/features/social/UserName";
import { aiName, aiSeatTooltip } from "~/features/game/aiNames";
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
import type { JoinMode, RestartMode, TableDetailView } from "./types";

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
  // „Im Spiel" = eine Game-Section wird gerendert (Felt + Chat-Seitenleiste).
  // Dann wandern die Sitze in die Seitenleiste (unter den Chat) statt nach oben.
  const inGame =
    !!data.currentGameId &&
    (data.status === "IN_GAME" || data.status === "POST_GAME" || data.status === "MATCH_OVER");

  return (
    // Scroll-Anchoring ist global am body abgeschaltet (siehe styles.css) —
    // das deckt diesen Tisch-Bereich samt aller Kind-Elemente ab.
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

      {/* Sitze oben NUR in der Wartephase — im Spiel wandern sie in die
          Chat-Seitenleiste (siehe GameSection), damit oben Tisch + Hand stehen. */}
      {!inGame && <SeatRow seats={data.seats} nameSeed={data.id} />}

      {data.currentGameId &&
        (data.status === "IN_GAME" ||
          data.status === "POST_GAME" ||
          data.status === "MATCH_OVER") &&
        (data.variant === "BODENSEE_2P" ? (
          <BodenseeGameSection
            gameId={data.currentGameId}
            tableId={data.id}
            tableSeats={data.seats}
            isAtTable={amIAtTable}
            tableStatus={data.status}
            nameSeed={data.id}
          />
        ) : (
          <GameSection
            gameId={data.currentGameId}
            tableId={data.id}
            tableSeats={data.seats}
            isAtTable={amIAtTable}
            tableStatus={data.status}
            isFirstGame={data.cumulativeScores.every((s) => s === 0)}
            cumulativeScores={data.cumulativeScores}
            targetScore={data.targetScore}
            nameSeed={data.id}
          />
        ))}

      {/* Wartephasen-Chat: derselbe tisch-weite Kanal wie im Spiel, damit der
          Verlauf vom Warten über den Spielstart hinweg bleibt. In-Game sitzt
          der Chat in der GameSection-Seitenleiste. */}
      {data.status === "WAITING" && amIAtTable && (
        <ChatPanel channelKey={`table:${data.id}`} title={t("lobby.tableDetail.tableChat")} />
      )}

      {/* Partie-Stand bewusst weiter unten, direkt über den Aktionen — oben
          bleibt Platz für Tisch + Hand (weniger Scrollen). */}
      <CumulativeScoreBar table={data} />

      {isOwner ? (
        <OwnerPanel table={data} queryKey={queryKey} ownerSeated={amIAtTable} />
      ) : amIAtTable ? (
        <PlayerPanel tableId={tableId} tableStatus={data.status} queryKey={queryKey} />
      ) : null}
    </section>
  );
}

function SeatRow({
  seats,
  nameSeed,
  stacked = false,
  inferenceAvailable = true,
}: {
  seats: TableDetailView["seats"];
  nameSeed: string;
  /** Vertikale Liste (für die Chat-Seitenleiste) statt 2-spaltigem Raster. */
  stacked?: boolean;
  /**
   * Inferenz-Service erreichbar? Steuert den KI-Engine-Tooltip (nn vs.
   * Heuristik-Fallback). Außerhalb des laufenden Spiels nicht bekannt → `true`.
   */
  inferenceAvailable?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul
      className={stacked ? "grid grid-cols-1 gap-2" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}
      aria-label={t("lobby.tableDetail.seatsLabel")}
    >
      {seats.map((s) => (
        <li
          key={s.seat}
          className="rounded border border-stone-200 px-3 py-2 flex items-center gap-3"
        >
          <span className="rounded bg-stone-100 text-stone-600 px-2 py-0.5 text-xs">
            {t("lobby.tableDetail.seat", { n: s.seat + 1 })}
          </span>
          {s.isEmpty ? (
            <span className="text-stone-400 text-sm italic">
              {t("lobby.tableDetail.seatEmpty")}
            </span>
          ) : s.user ? (
            <UserName userId={s.user.id} name={s.user.name} className="font-medium" />
          ) : s.aiSeatType ? (
            <span
              className="cursor-help text-stone-600"
              title={aiSeatTooltip(t, s.aiSeatType, inferenceAvailable)}
            >
              {aiName(`${nameSeed}:${s.seat}`, s.aiSeatType)}
            </span>
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
  // Immer einblenden, sobald es Punktekonten gibt — auch vor dem ersten Spiel
  // (zeigt Ziel + 0:0), damit der Partie-Stand nicht erst nach Spiel 1 „einpoppt".
  if (scores.length === 0) return null;
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

  // Engine-Tooltip am Roboter-Symbol des Partie-Stands — nur Einzelspieler-Zeilen
  // (Solo/Bodensee) mit individuellem KI-Namen; Kreuz-Team-Labels haben kein
  // einzelnes Symbol. Der Inferenz-Status liegt auf Tisch-Ebene nicht vor → „nn"
  // optimistisch; das Brett zeigt im Spiel den maßgeblichen Live-Zustand.
  const titleFor = (teamIdx: number): string | undefined => {
    if (!isPerPlayer) return undefined;
    const seat = table.seats.find((s) => s.seat === teamIdx);
    return seat?.aiSeatType ? aiSeatTooltip(t, seat.aiSeatType, true) : undefined;
  };

  return (
    <section
      className="rounded-lg border border-jass-paperEdge bg-jass-paper p-3 space-y-2 panel-jass"
      aria-label={t("lobby.tableDetail.scoreLabel")}
    >
      <div className="flex items-baseline justify-between text-sm text-jass-inkSoft">
        <span>
          {table.status === "MATCH_OVER" ? (
            <strong className="text-jass-ink">{t("lobby.tableDetail.scoreResult")}</strong>
          ) : (
            <Trans
              i18nKey="lobby.tableDetail.scoreProgress"
              values={{ target }}
              components={{ strong: <strong className="text-jass-ink" /> }}
            />
          )}
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
          labelTitle={titleFor(i)}
          score={score}
          pct={Math.min(100, Math.round((score / target) * 100))}
          highlight={winner === i}
          sacked={table.sackedPoints[i] ?? 0}
        />
      ))}
    </section>
  );
}

function ScoreRow({
  label,
  labelTitle,
  score,
  pct,
  highlight,
  sacked,
}: {
  label: string;
  /** Optionaler Tooltip am Label (KI-Engine-Hinweis am Roboter-Symbol). */
  labelTitle?: string | undefined;
  score: number;
  pct: number;
  highlight: boolean;
  /** Über die Partie „im Sack" verfallene Punkte dieses Kontos (reine Info). */
  sacked: number;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span
          className={labelTitle ? "cursor-help text-jass-ink" : "text-jass-ink"}
          title={labelTitle}
        >
          {label}
        </span>
        <span className={highlight ? "font-bold text-jass-yellowDark" : "text-jass-ink"}>
          {score}
          {sacked > 0 && (
            <span className="ml-1 text-xs font-normal text-jass-inkSoft">
              ({t("lobby.tableDetail.sackedHint", { n: sacked })})
            </span>
          )}
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

function OwnerPanel(props: {
  table: TableDetailView;
  queryKey: readonly unknown[];
  /** Sitzt der Owner selbst am Tisch? Wenn nein = „hängengebliebener" Tisch. */
  ownerSeated: boolean;
}) {
  const { t } = useTranslation();
  const { table, queryKey, ownerSeated } = props;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDissolve, setConfirmDissolve] = useState(false);

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
  // Owner löst den Tisch auf — schließt ihn für alle, auch wenn der Owner nicht
  // (mehr) sitzt. Behebt verwaiste Tische, bei denen „Verlassen" nicht greift.
  const closeMut = useMutation({
    mutationFn: () =>
      api<{ tableClosed: boolean }>(`/api/lobby/tables/${table.id}/close`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lobby", "my-tables"] });
      queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
      setConfirmDissolve(false);
      void navigate({ to: "/lobby" });
    },
    onError: (err: unknown) => {
      // 404/409 → Tisch existiert nicht mehr / ist schon zu → Wunsch erfüllt.
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        queryClient.invalidateQueries({ queryKey: ["lobby", "my-tables"] });
        queryClient.invalidateQueries({ queryKey: ["lobby", "list"] });
        setConfirmDissolve(false);
        void navigate({ to: "/lobby" });
        return;
      }
      // eslint-disable-next-line no-console
      console.error("Tisch-auflösen-Fehler:", err);
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

      {/* Tisch-Einstellungen lassen sich vor dem Start noch ändern
          (PATCH /api/lobby/tables/:id). */}
      {table.status === "WAITING" && <TableSettingsEditor table={table} queryKey={queryKey} />}

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
        {/* „Tisch auflösen" erscheint NUR im hängengebliebenen Zustand: der
            Owner ist nicht (mehr) gesetzt (er hat „Verlassen" gedrückt, aber der
            Tisch wurde nicht sauber geschlossen). Im Normalfall nie sichtbar. */}
        {!ownerSeated && (
          <button
            type="button"
            onClick={() => setConfirmDissolve(true)}
            disabled={closeMut.isPending}
            className="rounded border border-jass-red px-4 py-2 text-jass-red hover:bg-jass-red/10 disabled:opacity-50"
          >
            {t("lobby.tableDetail.dissolveTable")}
          </button>
        )}
      </div>
      <LeaveTableConfirm
        open={confirmLeave}
        tableStatus={table.status}
        pending={leaveMut.isPending}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => leaveMut.mutate()}
      />
      <LeaveTableConfirm
        open={confirmDissolve}
        tableStatus={table.status}
        pending={closeMut.isPending}
        dissolve
        onCancel={() => setConfirmDissolve(false)}
        onConfirm={() => closeMut.mutate()}
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
  tableId,
  tableSeats,
  isAtTable,
  tableStatus,
  isFirstGame,
  cumulativeScores,
  targetScore,
  nameSeed,
}: {
  gameId: string;
  /** Tisch-ID — für den tisch-weiten Chat (bleibt über Re-Matches stabil). */
  tableId: string;
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
      {/* Rechte Spalte: Chat + darunter die Sitze als Liste (füllt die vorher
          halbleere Chat-Spalte; die Namen sind auf dem Felt ohnehin schon). */}
      <div className="flex h-full flex-col gap-4">
        {/* fillHeight + flex-1: der Chat füllt die Spalte bis zur Brett-Höhe
            (statt fix 24rem) — relevant bei Bodensee, wo das Brett mit dem
            Spielverlauf höher als 24rem werden kann. */}
        <ChatPanel
          channelKey={`table:${tableId}`}
          title={t("lobby.tableDetail.tableChat")}
          className="flex-1"
          fillHeight
        />
        <SeatRow
          seats={tableSeats}
          nameSeed={nameSeed}
          stacked
          inferenceAvailable={view.inferenceAvailable}
        />
      </div>
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
  tableId,
  tableSeats,
  isAtTable,
  tableStatus,
  nameSeed,
}: {
  gameId: string;
  /** Tisch-ID — für den tisch-weiten Chat (stabil über Re-Matches). */
  tableId: string;
  tableSeats: TableDetailView["seats"];
  isAtTable: boolean;
  tableStatus: TableDetailView["status"];
  /** Seed für stabile KI-Namen — die Tisch-ID. */
  nameSeed: string;
}) {
  const { t } = useTranslation();
  const {
    view,
    error,
    movePending,
    announcePending,
    playCard,
    announce,
    opponentLeft,
    dismissOpponentLeft,
  } = useBodenseeView(isAtTable ? gameId : null);

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
      <OpponentLeftDialog
        open={opponentLeft !== null}
        name={opponentLeft?.name ?? ""}
        reason={opponentLeft?.reason ?? "left"}
        tableId={tableId}
        onPlayOn={dismissOpponentLeft}
      />
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
      {/* Rechte Spalte: Chat + darunter die Sitze als Liste. */}
      <div className="flex h-full flex-col gap-4">
        {/* fillHeight + flex-1: der Chat füllt die Spalte bis zur Brett-Höhe
            (statt fix 24rem) — relevant bei Bodensee, wo das Brett mit dem
            Spielverlauf höher als 24rem werden kann. */}
        <ChatPanel
          channelKey={`table:${tableId}`}
          title={t("lobby.tableDetail.tableChat")}
          className="flex-1"
          fillHeight
        />
        <SeatRow
          seats={tableSeats}
          nameSeed={nameSeed}
          stacked
          inferenceAvailable={view.inferenceAvailable}
        />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tisch-Einstellungen nachträglich ändern (Owner, nur solange WAITING).
// Spiegelt die änderbaren Felder von PATCH /api/lobby/tables/:id; Labels
// kommen aus denselben i18n-Keys wie der Eröffnungs-Dialog.
// ─────────────────────────────────────────────────────────────────────

type AiSeatTypeChoice = "random" | "heuristic" | "nn";
const JOIN_MODE_CHOICES: readonly JoinMode[] = ["OPEN", "REQUEST", "INVITE"];
const AI_TYPE_CHOICES: readonly AiSeatTypeChoice[] = ["heuristic", "nn", "random"];
const RESTART_CHOICES: readonly RestartMode[] = ["SIEGER_GIBT", "WELI"];
const AUTO_FILL_CHOICES: readonly (number | null)[] = [null, 15, 30, 60, 120];

/** „nn-v0.9.2" etc. auf den Editor-Wert „nn" eindampfen. */
function normalizeAiChoice(value: string): AiSeatTypeChoice {
  if (value === "random") return "random";
  if (value.startsWith("nn")) return "nn";
  return "heuristic";
}

function TableSettingsEditor(props: { table: TableDetailView; queryKey: readonly unknown[] }) {
  const { t } = useTranslation();
  const { table, queryKey } = props;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [joinMode, setJoinMode] = useState<JoinMode>(table.joinMode);
  const [aiSeatType, setAiSeatType] = useState<AiSeatTypeChoice>(
    normalizeAiChoice(table.aiSeatType)
  );
  const [autoFillSeconds, setAutoFillSeconds] = useState<number | null>(table.autoFillSeconds);
  const [restartMode, setRestartMode] = useState<RestartMode>(table.restartMode);
  const [targetScore, setTargetScore] = useState<number>(table.targetScore);

  const saveMut = useMutation({
    mutationFn: () =>
      api(`/api/lobby/tables/${table.id}`, {
        method: "PATCH",
        body: { joinMode, aiSeatType, autoFillSeconds, restartMode, targetScore },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setOpen(false);
    },
  });
  const saveError = saveMut.error instanceof ApiError ? saveMut.error.message : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-stone-600 underline hover:text-stone-900"
      >
        {t("lobby.tableDetail.editSettings")}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-stone-200 bg-stone-50 p-3">
      <h3 className="text-sm font-semibold text-stone-700">
        {t("lobby.tableDetail.editSettings")}
      </h3>
      <SettingsSelect
        label={t("lobby.openTable.sections.joinMode")}
        value={joinMode}
        onChange={(v) => setJoinMode(v as JoinMode)}
        options={JOIN_MODE_CHOICES.map((m) => ({
          value: m,
          label: t(`lobby.openTable.joinMode.${m}.title`),
        }))}
      />
      <SettingsSelect
        label={t("lobby.openTable.sections.aiType")}
        value={aiSeatType}
        onChange={(v) => setAiSeatType(v as AiSeatTypeChoice)}
        options={AI_TYPE_CHOICES.map((a) => ({
          value: a,
          label: t(`lobby.openTable.aiType.${a}.title`),
        }))}
      />
      <SettingsSelect
        label={t("lobby.openTable.sections.autoFill")}
        value={autoFillSeconds === null ? "off" : String(autoFillSeconds)}
        onChange={(v) => setAutoFillSeconds(v === "off" ? null : Number(v))}
        options={AUTO_FILL_CHOICES.map((o) => ({
          value: o === null ? "off" : String(o),
          label: o === null ? t("lobby.openTable.autoFillPreset.off") : `${o} s`,
        }))}
      />
      <SettingsSelect
        label={t("lobby.openTable.sections.restart")}
        value={restartMode}
        onChange={(v) => setRestartMode(v as RestartMode)}
        options={RESTART_CHOICES.map((r) => ({
          value: r,
          label: t(`lobby.openTable.restart.${r}.title`),
        }))}
      />
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-stone-600">{t("lobby.openTable.sections.targetScore")}</span>
        <input
          type="number"
          min={500}
          max={5000}
          step={50}
          value={targetScore}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setTargetScore(n);
          }}
          className="w-24 rounded border border-stone-300 px-2 py-1"
        />
      </label>
      {saveError && (
        <p role="alert" className="text-xs text-rose-700">
          {saveError}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="rounded bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {saveMut.isPending
            ? t("lobby.tableDetail.savingSettings")
            : t("lobby.tableDetail.saveSettings")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100"
        >
          {t("lobby.tableDetail.cancelSettings")}
        </button>
      </div>
    </div>
  );
}

function SettingsSelect(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-stone-600">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded border border-stone-300 bg-white px-2 py-1"
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
