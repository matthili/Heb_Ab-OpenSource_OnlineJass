/**
 * **MatchOverOverlay** — der große Partie-Abschluss (MATCH_OVER), wenn ein
 * Team/Spieler das Punkteziel über mehrere Spiele erreicht hat.
 *
 * Trigger (im Aufrufer): `tableStatus === "MATCH_OVER" && view.status === "finished"`.
 *
 * Inhalt:
 *   - „Partie gewonnen!"-Banner mit Pokal, Goldverlauf wenn man selbst (Solo)
 *     bzw. das eigene Team (Kreuz) gewonnen hat — sonst neutral.
 *   - „{Name(n)} haben die Partie gewonnen!" (Kreuz: zwei Namen mit „+",
 *     Solo: ein Name).
 *   - Kompakter Endstand (kumulative Partie-Punkte, absteigend).
 *   - Goldpartikel-Confetti (gleicher Effekt wie MatschOverlay).
 *   - Klick schließt das Overlay (kein Auto-Dismiss — Partie-Ende ist der
 *     Höhepunkt und ein Re-Match gibt es auf dieser gameId nicht mehr).
 *
 * **Sieger-Ermittlung**: rein aus `cumulativeScores` (kumulative Partie-
 * Stände — 2 Einträge bei Kreuz = Teams, 4 bei Solo = Spieler). Höchster
 * Stand gewinnt; der Server hat MATCH_OVER ohnehin erst gesetzt, als ein
 * Konto das Ziel überschritt.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SeatView } from "~/features/lobby/types";
import { seatDisplayName } from "./aiNames";

const CONFETTI_COUNT = 40;

interface Props {
  gameId: string;
  /** Kumulative Partie-Stände: 2 bei Kreuz (Teams), 4 bei Solo (Spieler). */
  cumulativeScores: readonly number[];
  mySeat: number;
  seats: readonly SeatView[];
  /** Seed für stabile KI-Namen (Tisch-ID). */
  nameSeed: string;
}

export function MatchOverOverlay({ gameId, cumulativeScores, mySeat, seats, nameSeed }: Props) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  // Bei gameId-Wechsel (sollte bei MATCH_OVER nicht passieren) zurücksetzen.
  useEffect(() => {
    setDismissed(false);
  }, [gameId]);

  const confetti = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => {
        const angle = (i / CONFETTI_COUNT) * Math.PI * 2;
        const distance = 200 + ((i * 37) % 140); // deterministisch
        return {
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
          delay: (i % 8) * 60,
          color: i % 3 === 0 ? "#f59e0b" : i % 3 === 1 ? "#fbbf24" : "#facc15",
        };
      }),
    []
  );

  if (dismissed) return null;
  if (cumulativeScores.length === 0) return null;

  // Solo = 4 Konten (jeder Spieler eigenes „Team"); Kreuz = 2 Konten.
  const isSolo = cumulativeScores.length === 4;

  // Sieger = höchster kumulativer Stand. winnerIndex ist bei Solo der Sitz,
  // bei Kreuz die Team-ID (0/1).
  let winnerIndex = 0;
  for (let i = 1; i < cumulativeScores.length; i++) {
    if ((cumulativeScores[i] ?? 0) > (cumulativeScores[winnerIndex] ?? 0)) winnerIndex = i;
  }

  const nameOfSeat = (seat: number): string => {
    const s = seats.find((x) => x.seat === seat);
    return s
      ? seatDisplayName(s, nameSeed, t("game.seatFallback", { n: seat + 1 }))
      : t("game.seatFallback", { n: seat + 1 });
  };

  // Gewinner-Sitze: Solo = nur der Sitz, Kreuz = beide Sitze des Teams
  // (Team 0 → Sitze 0+2, Team 1 → Sitze 1+3).
  const winningSeats = isSolo ? [winnerIndex] : [winnerIndex, winnerIndex + 2];
  const winnerNames = winningSeats.map(nameOfSeat);
  const iWon = isSolo ? mySeat === winnerIndex : mySeat % 2 === winnerIndex;

  // Endstand absteigend.
  const standings = (
    isSolo
      ? cumulativeScores.map((score, seat) => ({
          label: nameOfSeat(seat),
          score,
          isWinner: seat === winnerIndex,
        }))
      : cumulativeScores.map((score, team) => ({
          label: t("rematch.team", { team }),
          score,
          isWinner: team === winnerIndex,
        }))
  ).sort((a, b) => b.score - a.score);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="matchover-title"
      onClick={() => setDismissed(true)}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm rounded-lg p-4 cursor-pointer"
    >
      <div className="relative">
        {/* Confetti ringsherum */}
        {confetti.map((cf, i) => (
          <span
            key={i}
            className="jass-matsch-confetti"
            style={
              {
                left: "50%",
                top: "50%",
                background: cf.color,
                ["--dx" as never]: `${cf.dx}px`,
                ["--dy" as never]: `${cf.dy}px`,
                animationDelay: `${cf.delay}ms`,
              } as React.CSSProperties
            }
          />
        ))}

        <div
          className={`jass-matsch-card rounded-2xl border-4 px-10 py-8 text-center shadow-2xl ${
            iWon
              ? "border-jass-yellowDark bg-gradient-to-br from-jass-yellow via-amber-200 to-jass-yellow text-jass-ink"
              : "border-jass-paperEdge bg-gradient-to-br from-jass-paper via-jass-cream to-jass-paper text-jass-ink"
          }`}
        >
          <div className="text-5xl">🏆</div>
          <div
            id="matchover-title"
            className="mt-2 text-4xl font-black tracking-wide text-jass-ink"
          >
            {t("game.matchOver.banner")}
          </div>
          <div className="mt-2 text-lg font-semibold">
            {isSolo
              ? t("game.matchOver.wonBySolo", { name: winnerNames[0] })
              : t("game.matchOver.wonByTeam", { names: winnerNames.join(" + ") })}
          </div>
          {iWon && (
            <div className="mt-1 text-sm font-bold text-jass-green">
              {t("game.matchOver.youWon")}
            </div>
          )}

          {/* Endstand */}
          <div className="mt-4 mx-auto max-w-xs text-left">
            <div className="text-[11px] uppercase tracking-wide text-jass-inkSoft mb-1">
              {t("game.matchOver.standings")}
            </div>
            <ul className="space-y-0.5">
              {standings.map((row, i) => (
                <li
                  key={i}
                  className={`flex items-baseline justify-between gap-4 text-sm ${
                    row.isWinner ? "font-bold text-jass-ink" : "text-jass-inkSoft"
                  }`}
                >
                  <span className="truncate">
                    {row.isWinner ? "★ " : ""}
                    {row.label}
                  </span>
                  <span className="tabular-nums">{row.score}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 text-xs text-jass-inkSoft">{t("game.matchOver.clickToClose")}</div>
        </div>
      </div>
    </div>
  );
}
