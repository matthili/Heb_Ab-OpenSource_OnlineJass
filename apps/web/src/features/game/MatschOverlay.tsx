/**
 * **MatschOverlay** — wird einmalig pro Spielende angezeigt, wenn das
 * Sieger-Team einen Matsch (alle 9 Stiche) erzielt hat.
 *
 * Trigger: `view.status === "finished" && view.finalScore.matsch_team !== null`.
 *
 * Inhalt:
 *   - Großer „MATSCH!"-Banner mit Bounce-In + leichtem Wackeln.
 *   - Team-Label („Team 0 / Team 1") und subjektive Aussage („Gewonnen!" vs.
 *     „Verloren") basierend auf eigenem Sitz.
 *   - 32 Goldpartikel-Confetti, die nach außen driften.
 *   - Auto-dismiss nach 5 s; oder Klick aufs Overlay → sofort weg.
 *
 * **Position**: `absolute inset-0` Backdrop über dem `GameBoard`-Container
 *  (gleiches Pattern wie `DisconnectOverlay` / `WeisenResultOverlay`).
 *  Damit bleibt der Chat-Bereich rechts bedienbar.
 *
 * **Dismiss-State** pro gameId in lokalem State — nicht in localStorage,
 * weil Matsch-Animationen pro Spiel-Ende einmalig sein sollen; bei
 * Re-Match kommt ein neues gameId und das Overlay läuft wieder an.
 */
import { useEffect, useMemo, useState } from "react";

import type { SeatView } from "~/features/lobby/types";
import type { FinalScore } from "./types";

const AUTO_DISMISS_MS = 5000;
const CONFETTI_COUNT = 32;

interface Props {
  gameId: string;
  finalScore: FinalScore | undefined;
  mySeat: number;
  teams: readonly number[]; // [0,1,0,1] Kreuz · [0,1,2,3] Solo
  /** Sitze des Tisches — für die Namens-Auflösung im Solo-Modus. */
  seats?: readonly SeatView[];
}

export function MatschOverlay({ gameId, finalScore, mySeat, teams, seats }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // Wenn die gameId wechselt (Rematch), Dismiss zurücksetzen.
  useEffect(() => {
    setDismissed(false);
  }, [gameId]);

  // Confetti-Partikel einmalig deterministisch erzeugen — sonst würden
  // sie bei jedem Re-Render an neuen Positionen erscheinen.
  const confetti = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => {
        // Polar-Koordinaten — gleichmäßige Verteilung um den Banner herum.
        const angle = (i / CONFETTI_COUNT) * Math.PI * 2;
        const distance = 200 + ((i * 37) % 120); // pseudo-random, deterministic
        return {
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance,
          delay: (i % 8) * 60, // ms
          color: i % 3 === 0 ? "#f59e0b" : i % 3 === 1 ? "#fbbf24" : "#facc15",
        };
      }),
    []
  );

  // Auto-dismiss-Timer
  useEffect(() => {
    if (dismissed) return;
    if (!finalScore || finalScore.matsch_team === null) return;
    const t = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [dismissed, finalScore]);

  if (dismissed) return null;
  if (!finalScore || finalScore.matsch_team === null) return null;

  const matschTeam = finalScore.matsch_team;
  const myTeam = teams[mySeat] ?? 0;
  const iWon = myTeam === matschTeam;

  // Solo = jeder Sitz ein eigenes Team. Dann ist matsch_team eine
  // Spieler-ID (Team-ID == Sitz) — wir zeigen den Namen statt „Team X".
  const isSolo = new Set(teams).size === teams.length;
  const matschLabel = isSolo
    ? (() => {
        const s = seats?.find((x) => x.seat === matschTeam);
        if (s?.user) return s.user.name;
        if (s?.aiSeatType) return `KI (Sitz ${matschTeam + 1})`;
        return `Sitz ${matschTeam + 1}`;
      })()
    : `Team ${matschTeam}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="matsch-title"
      onClick={() => setDismissed(true)}
      className="absolute inset-0 z-40 flex items-center justify-center bg-stone-900/65 backdrop-blur-sm rounded-lg p-4 cursor-pointer"
    >
      <div className="relative">
        {/* Confetti ringsherum */}
        {confetti.map((c, i) => (
          <span
            key={i}
            className="jass-matsch-confetti"
            style={
              {
                left: "50%",
                top: "50%",
                background: c.color,
                ["--dx" as never]: `${c.dx}px`,
                ["--dy" as never]: `${c.dy}px`,
                animationDelay: `${c.delay}ms`,
              } as React.CSSProperties
            }
          />
        ))}

        {/* Banner */}
        <div
          className={`jass-matsch-card rounded-2xl border-4 px-10 py-8 text-center shadow-2xl ${
            iWon
              ? "border-jass-yellowDark bg-gradient-to-br from-jass-yellow via-amber-200 to-jass-yellow text-jass-ink"
              : "border-rose-500 bg-gradient-to-br from-rose-100 via-stone-100 to-rose-100 text-stone-800"
          }`}
        >
          <div
            id="matsch-title"
            className={`text-5xl font-black tracking-wide ${iWon ? "text-jass-ink" : "text-rose-700"}`}
          >
            MATSCH!
          </div>
          <div className="mt-2 text-lg font-semibold">
            {iWon ? "Alle 9 Stiche — Hut ab!" : `${matschLabel} hat alle 9 Stiche.`}
          </div>
          <div className="mt-3 text-xs text-stone-600">(klicken zum Schließen)</div>
        </div>
      </div>
    </div>
  );
}
