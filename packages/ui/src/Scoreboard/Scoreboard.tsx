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
 * **Animation**:
 *   - Team-Punkte werden über `useAnimatedNumber` weich hochgezählt.
 *   - Bei einer Punkt-Steigerung schwebt zusätzlich ein „+X"-Bubble
 *     kurz über dem Score auf (Score-Pop). Das ist subtil, gibt aber
 *     ein klares „du hast den Stich gewonnen"-Feedback.
 */
import { useEffect, useRef, useState } from "react";
import type { PlayMode, Suit } from "@jass/engine";

import { useAnimatedNumber } from "./useAnimatedNumber.js";

/** Ein Spieler-Konto im Solo-Scoreboard. */
export interface SoloScoreEntryData {
  /** Anzeige-Name des Sitzes. */
  label: string;
  points: number;
  /** true → der eigene Sitz (visuell hervorgehoben). */
  isMe: boolean;
}

export interface ScoreboardProps {
  ownTeamScore: number;
  oppTeamScore: number;
  trickIdx: number; // 0..8
  /** Aktueller Mode des laufenden Stichs. */
  mode?: PlayMode;
  /** Trumpf-Farbe, nur relevant bei mode === "TRUMPF" oder "GUMPF". */
  trumpSuit?: Suit;
  /**
   * **Solo-Jass**: wenn gesetzt, zeigt das Scoreboard 4 Einzelkonten
   * statt der Team-Anzeige (own/opp werden dann ignoriert).
   */
  soloPlayers?: readonly SoloScoreEntryData[];
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

/**
 * Hook der einen „+X"-Pop-Trigger setzt, wenn der target-Wert steigt.
 * Returnt das Delta + einen `seq`-Counter, damit jeder Anstieg eine
 * neue Animation auslöst (React remountet das `key`-Element).
 */
function useScorePop(value: number): { delta: number; seq: number } | null {
  const prevRef = useRef(value);
  const [pop, setPop] = useState<{ delta: number; seq: number } | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (value > prev) {
      seqRef.current += 1;
      setPop({ delta: value - prev, seq: seqRef.current });
      // Pop nach 1,4 s wieder zurücksetzen (passt zur CSS-Animation).
      const id = setTimeout(() => setPop(null), 1400);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [value]);

  return pop;
}

/**
 * Ein einzelnes Solo-Konto mit Hochzähl-Animation + „+X"-Pop.
 * Eigene Komponente, damit die Hooks pro Spieler sauber instanziiert
 * werden (Hooks dürfen nicht in Schleifen stehen).
 */
function SoloScoreEntry({ label, points, isMe }: SoloScoreEntryData) {
  const animated = useAnimatedNumber(points);
  const pop = useScorePop(points);
  return (
    <span className={`relative ${isMe ? "text-jass-ink font-semibold" : "text-jass-inkSoft"}`}>
      {label}: <strong className="text-jass-ink tabular-nums">{animated}</strong>
      {pop && (
        <span
          key={pop.seq}
          className="jass-score-pop absolute -top-1 left-1/2 -translate-x-1/2 text-jass-green font-semibold text-base"
        >
          +{pop.delta}
        </span>
      )}
    </span>
  );
}

export function Scoreboard({
  ownTeamScore,
  oppTeamScore,
  trickIdx,
  mode,
  trumpSuit,
  soloPlayers,
}: ScoreboardProps) {
  const modeText = mode
    ? mode === "TRUMPF" || mode === "GUMPF"
      ? `${MODE_LABEL[mode]} · ${trumpSuit ? SUIT_LABEL[trumpSuit] : "?"}`
      : MODE_LABEL[mode]
    : null;

  // ── Solo-Variante: 4 Einzelkonten ───────────────────────────────────
  // Routing-Only: KEINE Hooks in dieser Funktion — die Team- und Solo-
  // Varianten sind eigene Komponenten, damit der bedingte Render keinen
  // Rules-of-Hooks-Verstoß verursacht.
  if (soloPlayers && soloPlayers.length > 0) {
    return (
      <div className="flex gap-4 text-sm border-b border-jass-paperEdge pb-2 items-center flex-wrap">
        {soloPlayers.map((p, i) => (
          <SoloScoreEntry key={i} label={p.label} points={p.points} isMe={p.isMe} />
        ))}
        {modeText && (
          <span className="rounded bg-jass-yellow px-2 py-0.5 text-xs text-jass-ink font-medium">
            {modeText}
          </span>
        )}
        <span className="ml-auto text-jass-inkSoft">Stich {trickIdx + 1} / 9</span>
      </div>
    );
  }

  return (
    <TeamScoreboard
      ownTeamScore={ownTeamScore}
      oppTeamScore={oppTeamScore}
      trickIdx={trickIdx}
      modeText={modeText}
    />
  );
}

/** Team-Scoreboard (Kreuz-Jass): own vs. opp mit Hochzähl-Animation. */
function TeamScoreboard({
  ownTeamScore,
  oppTeamScore,
  trickIdx,
  modeText,
}: {
  ownTeamScore: number;
  oppTeamScore: number;
  trickIdx: number;
  modeText: string | null;
}) {
  const ownAnimated = useAnimatedNumber(ownTeamScore);
  const oppAnimated = useAnimatedNumber(oppTeamScore);
  const ownPop = useScorePop(ownTeamScore);
  const oppPop = useScorePop(oppTeamScore);

  return (
    <div className="flex gap-4 text-sm border-b border-jass-paperEdge pb-2 items-center">
      <span className="text-jass-inkSoft relative">
        Eigenes Team: <strong className="text-jass-ink tabular-nums">{ownAnimated}</strong>
        {ownPop && (
          <span
            key={ownPop.seq}
            className="jass-score-pop absolute -top-1 left-1/2 -translate-x-1/2 text-jass-green font-semibold text-base"
          >
            +{ownPop.delta}
          </span>
        )}
      </span>
      <span className="text-jass-inkSoft relative">
        Gegner: <strong className="text-jass-ink tabular-nums">{oppAnimated}</strong>
        {oppPop && (
          <span
            key={oppPop.seq}
            className="jass-score-pop absolute -top-1 left-1/2 -translate-x-1/2 text-jass-red font-semibold text-base"
          >
            +{oppPop.delta}
          </span>
        )}
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
