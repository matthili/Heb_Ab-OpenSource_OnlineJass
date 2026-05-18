/**
 * Scoreboard — kompakte Punktezeile, die wir oberhalb der Spielfläche
 * anzeigen.
 *
 * Bei Kreuz-Jass: zwei Teams (Sitz 0+2 / Sitz 1+3), Punkte werden während
 * der Runde live mitgezählt (own_team_score / opp_team_score aus dem
 * GameState).
 *
 * **Trumpf-Anzeige**: optional. Wenn gesetzt, zeigt sie Suit-Name +
 * Mode. So weiß der Spieler immer, „wir spielen Eichel-Trumpf" /
 * „Oben-Abe" etc.
 *
 * **Animation**: Die Team-Punkte werden über `useAnimatedNumber` weich
 * hochgezählt, wenn ein Stich-Wert dazukommt — wirkt lebendiger als
 * ein hartes Springen.
 */
import type { PlayMode, Suit } from "@jass/engine";

import { useAnimatedNumber } from "./useAnimatedNumber.js";

export interface ScoreboardProps {
  ownTeamScore: number;
  oppTeamScore: number;
  trickIdx: number; // 0..8
  /** Aktueller Mode des laufenden Stichs. */
  mode?: PlayMode;
  /** Trumpf-Farbe, nur relevant bei mode === "TRUMPF" oder "GUMPF". */
  trumpSuit?: Suit;
}

const SUIT_LABEL: Record<Suit, string> = {
  EICHEL: "Eichel",
  SCHELLE: "Schelle",
  HERZ: "Herz",
  LAUB: "Laub",
};

const MODE_LABEL: Record<PlayMode, string> = {
  TRUMPF: "Trumpf",
  GUMPF: "Gumpf",
  OBEN: "Oben",
  UNTEN: "Unten",
};

export function Scoreboard({
  ownTeamScore,
  oppTeamScore,
  trickIdx,
  mode,
  trumpSuit,
}: ScoreboardProps) {
  const modeText = mode
    ? mode === "TRUMPF" || mode === "GUMPF"
      ? `${MODE_LABEL[mode]} · ${trumpSuit ? SUIT_LABEL[trumpSuit] : "?"}`
      : MODE_LABEL[mode]
    : null;

  // Punkte weich hochzählen statt schlagartig springen.
  const ownAnimated = useAnimatedNumber(ownTeamScore);
  const oppAnimated = useAnimatedNumber(oppTeamScore);

  return (
    <div className="flex gap-4 text-sm border-b border-jass-paperEdge pb-2 items-center">
      <span className="text-jass-inkSoft">
        Eigenes Team: <strong className="text-jass-ink tabular-nums">{ownAnimated}</strong>
      </span>
      <span className="text-jass-inkSoft">
        Gegner: <strong className="text-jass-ink tabular-nums">{oppAnimated}</strong>
      </span>
      {modeText && (
        <span className="rounded bg-jass-yellow px-2 py-0.5 text-xs text-jass-ink font-medium">
          {modeText}
        </span>
      )}
      <span className="ml-auto text-jass-inkSoft">Stich {trickIdx + 1} / 9</span>
    </div>
  );
}
