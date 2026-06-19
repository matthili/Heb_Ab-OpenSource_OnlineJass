/**
 * Sitz-Aufstellung im Tisch-Wartebereich (4er/Solo, nur WAITING + Teilnehmer).
 *
 * Zwei Wege, die Aufstellung (= wer mit wem spielt) zu bestimmen:
 *   - **Freien oder KI-Sitz direkt nehmen** (`takeSeat`, kein Einverständnis).
 *   - **Mit einem Menschen tauschen** (Einverständnis): „Sitzplatz tauschen"
 *     (Stufe 1) → einen Mitspieler-Sitz wählen (Stufe 2) → der bekommt eine
 *     Rückfrage (siehe SeatSwapPrompt).
 *
 * Zeigt außerdem den **Start-Countdown** bei vollem Tisch (Spiel startet in Xs)
 * und den Stand eines laufenden Tauschs. Live-Updates kommen über das
 * `lobby:table-state`-WS-Push (seatSwap/startCountdown in der TableDetailView).
 */
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { aiName, aiSeatTooltip } from "~/features/game/aiNames";
import { UserName } from "~/features/social/UserName";
import { api, ApiError } from "~/lib/api";
import { useUserEvents } from "~/lib/ws";
import type { TableDetailView } from "./types";

type SeatSwapSnapshot = NonNullable<TableDetailView["seatSwap"]>;

/** Verbleibende Sekunden bis `targetMs` (Epoch). Tickt jede Sekunde; null = aus. */
export function useCountdownSeconds(targetMs: number | null | undefined): number | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (targetMs == null) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  if (targetMs == null) return null;
  return Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
}

export function SeatArrangementPanel({
  tableId,
  seats,
  myUserId,
  nameSeed,
  isOwner,
  seatSwap,
  startCountdown,
}: {
  tableId: string;
  seats: TableDetailView["seats"];
  myUserId: string | undefined;
  nameSeed: string;
  isOwner: boolean;
  seatSwap: TableDetailView["seatSwap"];
  startCountdown: TableDetailView["startCountdown"];
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mySeat = seats.find((s) => s.user?.id === myUserId);
  const amISeated = !!mySeat;
  const otherHumans = seats.filter((s) => s.user && s.user.id !== myUserId);
  const swap: SeatSwapSnapshot | null = seatSwap ?? null;
  const iAmRequester = swap?.requesterId === myUserId;
  const selecting = swap?.stage === "selecting";

  const onErr = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : t("lobby.seatSwap.genericError"));
  const clearErr = () => setError(null);

  const takeMut = useMutation({
    mutationFn: (seat: number) =>
      api(`/api/lobby/tables/${tableId}/seat`, { method: "POST", body: { seat } }),
    onMutate: clearErr,
    onError: onErr,
  });
  const requestMut = useMutation({
    mutationFn: () => api(`/api/lobby/tables/${tableId}/seat-swap/request`, { method: "POST" }),
    onMutate: clearErr,
    onError: onErr,
  });
  const pickMut = useMutation({
    mutationFn: (seat: number) =>
      api(`/api/lobby/tables/${tableId}/seat-swap/pick`, { method: "POST", body: { seat } }),
    onMutate: clearErr,
    onError: onErr,
  });
  const cancelMut = useMutation({
    mutationFn: () => api(`/api/lobby/tables/${tableId}/seat-swap/cancel`, { method: "POST" }),
    onMutate: clearErr,
    onError: onErr,
  });

  // Ergebnis-Feedback für den Anfragenden (Annahme aktualisiert die Sitze von
  // selbst über den State-Push → keine Notiz nötig; Ablehnung/Timeout schon).
  const onResult = useCallback(
    (payload: unknown) => {
      const p = payload as {
        tableId?: string;
        accepted?: boolean;
        timedOut?: boolean;
        declinedForever?: boolean;
      };
      if (p?.tableId !== tableId || p.accepted) return;
      setNotice(
        p.timedOut
          ? t("lobby.seatSwap.resultTimeout")
          : p.declinedForever
            ? t("lobby.seatSwap.resultDeclinedForever")
            : t("lobby.seatSwap.resultDeclined")
      );
      window.setTimeout(() => setNotice(null), 12000);
    },
    [tableId, t]
  );
  useUserEvents("lobby:seat-swap-result", onResult);

  // Countdown: Tausch-Frist (falls aktiv), sonst der Start-Countdown.
  const swapSeconds = useCountdownSeconds(swap ? swap.deadline : null);
  const startSeconds = useCountdownSeconds(!swap && startCountdown ? startCountdown.startAt : null);

  const canRequestSwap = amISeated && otherHumans.length > 0 && !swap;

  return (
    <section className="space-y-2" aria-label={t("lobby.seatSwap.title")}>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {seats.map((s) => {
          const isMine = s.user?.id === myUserId;
          const isHumanOther = !!s.user && !isMine;
          const showSwapTarget = selecting && iAmRequester && isHumanOther;
          const showTake =
            !swap && amISeated && !isMine && (s.isEmpty || (!s.user && !!s.aiSeatType));
          return (
            <li
              key={s.seat}
              className={`rounded border px-3 py-2 flex items-center gap-2 ${
                isMine ? "border-jass-yellowDark bg-jass-yellow/10" : "border-stone-200"
              }`}
            >
              <span className="rounded bg-stone-100 text-stone-600 px-2 py-0.5 text-xs shrink-0">
                {t("lobby.tableDetail.seat", { n: s.seat + 1 })}
              </span>
              <span className="flex-1 min-w-0 truncate">
                {s.isEmpty ? (
                  <span className="text-stone-400 text-sm italic">
                    {t("lobby.tableDetail.seatEmpty")}
                  </span>
                ) : s.user ? (
                  <span className="inline-flex items-center gap-1">
                    <UserName
                      userId={s.user.id}
                      name={s.user.name}
                      className="font-medium"
                      {...(isOwner && !isMine ? { kick: { tableId } } : {})}
                    />
                    {isMine && (
                      <span className="text-xs text-jass-yellowDark">
                        ({t("lobby.seatSwap.you")})
                      </span>
                    )}
                  </span>
                ) : s.aiSeatType ? (
                  <span
                    className="cursor-help text-stone-600"
                    title={aiSeatTooltip(t, s.aiSeatType, true)}
                  >
                    {aiName(`${nameSeed}:${s.seat}`, s.aiSeatType)}
                  </span>
                ) : null}
              </span>
              {showSwapTarget && (
                <button
                  type="button"
                  onClick={() => pickMut.mutate(s.seat)}
                  disabled={pickMut.isPending}
                  className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 shrink-0"
                >
                  {t("lobby.seatSwap.swapWith")}
                </button>
              )}
              {showTake && (
                <button
                  type="button"
                  onClick={() => takeMut.mutate(s.seat)}
                  disabled={takeMut.isPending}
                  className="rounded border border-jass-paperEdge px-2 py-1 text-xs text-jass-ink hover:bg-jass-cream shrink-0"
                >
                  {s.aiSeatType
                    ? t("lobby.seatSwap.takeAiSeat")
                    : t("lobby.seatSwap.takeEmptySeat")}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {/* Status-/Aktionszeile */}
      <div className="flex items-center flex-wrap gap-2 text-sm">
        {swap ? (
          selecting ? (
            iAmRequester ? (
              <>
                <span className="text-jass-inkSoft">
                  {t("lobby.seatSwap.selectPrompt", { n: swapSeconds ?? 0 })}
                </span>
                <button
                  type="button"
                  onClick={() => cancelMut.mutate()}
                  disabled={cancelMut.isPending}
                  className="rounded border border-jass-paperEdge px-3 py-1 text-xs text-jass-ink hover:bg-jass-cream"
                >
                  {t("lobby.seatSwap.cancel")}
                </button>
              </>
            ) : (
              <span className="text-jass-inkSoft">{t("lobby.seatSwap.someoneSelecting")}</span>
            )
          ) : iAmRequester ? (
            <span className="text-jass-inkSoft">
              {t("lobby.seatSwap.awaitingResponse", { n: swapSeconds ?? 0 })}
            </span>
          ) : (
            <span className="text-jass-inkSoft">{t("lobby.seatSwap.swapInProgress")}</span>
          )
        ) : startCountdown ? (
          <span className="text-jass-ink font-medium">
            {t("lobby.seatSwap.startCountdown", { n: startSeconds ?? 0 })}
          </span>
        ) : null}

        {canRequestSwap && (
          <button
            type="button"
            onClick={() => requestMut.mutate()}
            disabled={requestMut.isPending}
            className="btn-jass-secondary text-xs"
          >
            {t("lobby.seatSwap.requestSwap")}
          </button>
        )}
      </div>
      {notice && (
        <p className="rounded-md border border-jass-paperEdge bg-jass-cream px-3 py-2 text-sm text-jass-ink">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
