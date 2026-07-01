/**
 * **VoidOverlay** — erklärt am Rundenende, wenn die eigenen Punkte durch eine
 * optionale Tisch-Regel verfallen sind:
 *   - „Sack": < 21 Kartenpunkte → ganze Runde (Karten + Weis) verfällt.
 *   - „Kein Stich": kein einziger Stich → Weis-Punkte verfallen.
 *
 * Zeigt sich NUR dem betroffenen Spieler (eigenes Team in `finalScore.voided`).
 * Klick / „Verstanden" schließt — kein Auto-Timer nötig, da explizit
 * wegklickbar (blockiert nichts: die Runde ist ohnehin vorbei).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { FinalScore } from "./types";

interface Props {
  gameId: string;
  finalScore: FinalScore | undefined;
  mySeat: number;
  /** Team-Zuordnung pro Sitz ([0,1,0,1] Kreuz · [0,1,2,3] Solo). */
  teams: readonly number[];
}

export function VoidOverlay({ gameId, finalScore, mySeat, teams }: Props) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [gameId]);

  if (dismissed) return null;
  const voided = finalScore?.voided ?? [];
  if (voided.length === 0) return null;

  // Nur die EIGENE Seite betrifft uns.
  const myTeam = teams[mySeat] ?? mySeat % 2;
  const mine = voided.find((v) => v.team === myTeam);
  if (!mine) return null;

  const isSack = mine.reason === "sack";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-title"
      onClick={() => setDismissed(true)}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-sm rounded-jass p-4 cursor-pointer"
    >
      <div className="max-w-sm rounded-2xl border-4 border-rose-400 bg-gradient-to-br from-rose-50 via-stone-50 to-rose-50 px-8 py-7 text-center shadow-2xl">
        <div className="text-5xl">💨</div>
        <h2 id="void-title" className="mt-2 text-2xl font-black text-rose-700">
          {isSack ? t("game.void.sackTitle") : t("game.void.noTrickTitle")}
        </h2>
        <p className="mt-2 text-sm text-stone-700">
          {isSack
            ? t("game.void.sackBody", { cardPoints: mine.cardPoints, lost: mine.lostPoints })
            : t("game.void.noTrickBody", { lost: mine.lostPoints })}
        </p>
        <button type="button" onClick={() => setDismissed(true)} className="btn-jass-primary mt-5">
          {t("game.void.ok")}
        </button>
      </div>
    </div>
  );
}
