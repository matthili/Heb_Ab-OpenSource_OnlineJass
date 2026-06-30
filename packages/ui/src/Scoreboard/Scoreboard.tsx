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
  /** true → dieses Konto hat „Stöck" angesagt (+20 am Rundenende). */
  stoeck?: boolean;
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
   * Slalom-Ansage: zeigt „Slalom (ab …)" statt der pro-Stich wechselnden
   * effektiven Variante. `mode` ist dann der Startmodus (OBEN/UNTEN).
   */
  slalom?: boolean;
  /**
   * **Solo-Jass**: wenn gesetzt, zeigt das Scoreboard 4 Einzelkonten
   * statt der Team-Anzeige (own/opp werden dann ignoriert).
   */
  soloPlayers?: readonly SoloScoreEntryData[];
  /**
   * **Stöck-Ansage (Kreuz-Jass)**: auf welcher Seite wurde „Stöck"
   * gerufen? `"own"` → eigenes Team, `"opp"` → Gegner. Zeigt ein
   * „+20 Stöck"-Abzeichen neben dem jeweiligen Team-Score, damit ALLE
   * Spieler die Ansage sehen (die +20 fallen erst am Rundenende an).
   */
  stoeckSide?: "own" | "opp" | null;
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
export function useScorePop(value: number): { delta: number; seq: number } | null {
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
 * Feuert einen einmaligen „Pop"-Trigger, sobald `active` von false auf
 * true wechselt (steigende Flanke) — gleiche 1,4-s-Lebensdauer wie der
 * Score-Pop. Damit fühlt sich eine Stöck-Ansage genauso an wie ein
 * gewonnener Stich („+20 Stöck" schwebt kurz auf) statt als lautes
 * Dauer-Abzeichen stehen zu bleiben. Bewusst proportional zum Weis:
 * der bekommt auch kein Dauer-Label, nur den kurzen Punkte-Pop.
 */
function useRisingEdgePop(active: boolean): { seq: number } | null {
  const prevRef = useRef(active);
  const [pop, setPop] = useState<{ seq: number } | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = active;
    if (active && !prev) {
      seqRef.current += 1;
      setPop({ seq: seqRef.current });
      const id = setTimeout(() => setPop(null), 1400);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [active]);

  return pop;
}

/**
 * Punktwert mit Hochzähl-Animation. Der „+X"-Pop (und der „+20 Stöck"-Pop)
 * schwebt GENAU über der Zahl — dafür umschließt ein `relative inline-block`
 * NUR den Wert, nicht das vorangestellte Label. Sonst zentriert der Pop über
 * „Eigenes Team:" / „Gegner:" statt über dem Punktewert (Veronika E1).
 */
function ScoreNumber({
  value,
  popColor,
  stoeck,
}: {
  value: number;
  /** Tailwind-Textfarbe des Pops (grün für eigenes Team, rot für Gegner). */
  popColor: string;
  /** Stöck angesagt → einmaliger „+20 Stöck"-Pop bei steigender Flanke. */
  stoeck?: boolean | undefined;
}) {
  const animated = useAnimatedNumber(value);
  const pop = useScorePop(value);
  const stoeckPop = useRisingEdgePop(!!stoeck);
  return (
    <span className="relative inline-block">
      <strong className="text-jass-ink tabular-nums">{animated}</strong>
      {pop && (
        <span
          key={pop.seq}
          className={`jass-score-pop absolute -top-1 left-1/2 -translate-x-1/2 font-semibold text-base ${popColor}`}
        >
          +{pop.delta}
        </span>
      )}
      {stoeckPop && (
        <span
          key={`stoeck-${stoeckPop.seq}`}
          className={`jass-score-pop absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap font-semibold text-base ${popColor}`}
        >
          +20 Stöck
        </span>
      )}
    </span>
  );
}

/**
 * Ein einzelnes Solo-Konto mit Hochzähl-Animation + „+X"-Pop über der Zahl.
 * Eigene Komponente, damit die Hooks pro Spieler sauber instanziiert
 * werden (Hooks dürfen nicht in Schleifen stehen).
 */
function SoloScoreEntry({ label, points, isMe, stoeck }: SoloScoreEntryData) {
  return (
    <span className={isMe ? "text-jass-ink font-semibold" : "text-jass-inkSoft"}>
      {label}: <ScoreNumber value={points} popColor="text-jass-green" stoeck={stoeck} />
    </span>
  );
}

export function Scoreboard({
  ownTeamScore,
  oppTeamScore,
  trickIdx,
  mode,
  trumpSuit,
  slalom,
  soloPlayers,
  stoeckSide,
}: ScoreboardProps) {
  const modeText = slalom
    ? `Slalom${mode ? ` · ab ${MODE_LABEL[mode]}` : ""}`
    : mode
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
      <div className="flex gap-4 text-sm rounded-lg border border-jass-paperEdge bg-jass-cream px-3 py-2 items-center flex-wrap panel-jass">
        {soloPlayers.map((p, i) => (
          <SoloScoreEntry
            key={i}
            label={p.label}
            points={p.points}
            isMe={p.isMe}
            stoeck={p.stoeck ?? false}
          />
        ))}
        {modeText && (
          <span className="jass-mode-glow rounded bg-jass-yellow px-2.5 py-1 text-sm text-jass-ink font-bold ring-1 ring-jass-yellowDark">
            Modus: {modeText}
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
      stoeckSide={stoeckSide ?? null}
    />
  );
}

/** Team-Scoreboard (Kreuz-Jass): own vs. opp mit Hochzähl-Animation. */
function TeamScoreboard({
  ownTeamScore,
  oppTeamScore,
  trickIdx,
  modeText,
  stoeckSide,
}: {
  ownTeamScore: number;
  oppTeamScore: number;
  trickIdx: number;
  modeText: string | null;
  stoeckSide?: "own" | "opp" | null;
}) {
  return (
    <div className="flex gap-4 text-sm rounded-lg border border-jass-paperEdge bg-jass-cream px-3 py-2 items-center panel-jass">
      <span className="text-jass-inkSoft">
        Eigenes Team:{" "}
        <ScoreNumber
          value={ownTeamScore}
          popColor="text-jass-green"
          stoeck={stoeckSide === "own"}
        />
      </span>
      <span className="text-jass-inkSoft">
        Gegner:{" "}
        <ScoreNumber value={oppTeamScore} popColor="text-jass-red" stoeck={stoeckSide === "opp"} />
      </span>
      {modeText && (
        <span className="jass-mode-glow rounded bg-jass-yellow px-2.5 py-1 text-sm text-jass-ink font-bold ring-1 ring-jass-yellowDark">
          Modus: {modeText}
        </span>
      )}
      <span className="ml-auto text-jass-inkSoft">Stich {trickIdx + 1} / 9</span>
    </div>
  );
}
