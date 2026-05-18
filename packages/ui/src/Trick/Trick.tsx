/**
 * Trick-Visualisierung — die im aktuellen Stich liegenden Karten an
 * ihren 4 Positionen.
 *
 * **Layout**: 3×3-Grid mit den 4 Sitz-Slots. Beim Jass-Spiel läuft die
 * Reihenfolge **im Uhrzeigersinn** — relativ zum eigenen Sitz heißt das:
 * Sitz 0 = bottom (ich), Sitz 1 = left (nächster Spieler), Sitz 2 = top
 * (Partner), Sitz 3 = right (vorheriger Spieler). Die Mitte (1,1) bleibt
 * leer.
 *
 * **Slot-Berechnung**: Karten kommen vom Server in Spiel-Reihenfolge,
 * beginnend bei `starter`. Karte `i` gehört absolut zu
 * `(starter + i) % 4`, relativ zum eigenen Sitz zu
 * `(absolute - mySeat + 4) % 4`.
 *
 * **Winner-Highlight**: optional — wenn `winnerSeat` gesetzt ist, wird
 * die Gewinner-Karte mit einem goldenen Ring markiert. Caller berechnet
 * den Winner via `trickWinner()` aus `@jass/engine`.
 *
 * **Animation**: Jede Karten-Wrapper bekommt die CSS-Klasse
 * `jass-card-enter` — beim Mount läuft eine 400-ms-Slide-In-Animation
 * (Fade + leichter Hoch-Slide + Settle-Bounce). Da React jede neue Karte
 * im `cards`-Array als neues DOM-Element mountet (key beinhaltet den
 * Index), feuert die Animation genau einmal pro gespielter Karte. Die
 * Gewinner-Karte bekommt zusätzlich `jass-trick-win-pulse` für ein
 * pulsierendes Glow-Highlight während des Linger.
 */
import type * as React from "react";
import type { Card as CardModel } from "@jass/engine";

import { Card } from "../Card/Card.js";

export interface TrickProps {
  cards: readonly CardModel[];
  /** Absoluter Sitz, der angefangen hat (0..3). */
  starter: number;
  /** Mein absoluter Sitz (0..3). */
  mySeat: number;
  /** Optional: Sitz, der den Trick gewinnt (für Highlight). */
  winnerSeat?: number;
}

type Slot = "bottom" | "left" | "top" | "right";
const SLOTS: readonly Slot[] = ["bottom", "left", "top", "right"];

const SLOT_POS: Record<Slot, string> = {
  bottom: "row-start-3 col-start-2 self-end justify-self-center",
  right: "row-start-2 col-start-3 self-center justify-self-end",
  top: "row-start-1 col-start-2 self-start justify-self-center",
  left: "row-start-2 col-start-1 self-center justify-self-start",
};

function relativeSlot(absolute: number, mySeat: number): Slot {
  const idx = (((absolute - mySeat) % 4) + 4) % 4;
  return SLOTS[idx]!;
}

export function Trick({ cards, starter, mySeat, winnerSeat }: TrickProps) {
  return (
    <div
      // Feste Höhe — damit das Trick-Sub-Grid nicht kollabiert, wenn der
      // Stich gerade leer ist (zwischen zwei Stichen). Sonst „springt" die
      // umgebende Spielfläche zwischen 0-Karten und 4-Karten-Zustand.
      className="grid grid-cols-3 grid-rows-3 gap-2 h-full min-h-[24rem]"
      role="region"
      aria-label="Stich"
    >
      {cards.map((c, i) => {
        const absoluteSeat = (starter + i) % 4;
        const slot = relativeSlot(absoluteSeat, mySeat);
        const isWinner = winnerSeat !== undefined && absoluteSeat === winnerSeat;
        const winnerCls = isWinner ? "ring-4 ring-amber-400 rounded-md jass-trick-win-pulse" : "";
        return (
          <div
            key={`${c.suit}-${c.rank}-${i}`}
            className={`${SLOT_POS[slot]} jass-card-enter relative ${winnerCls}`}
          >
            <Card card={c} size="md" />
            {isWinner && <Sparkles />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Vier goldene Funken die diagonal aus der Gewinner-Karte herausspringen.
 * Reine CSS-Animation (siehe `.jass-sparkle` in styles.css), kein JS-Tick.
 * Jeder Funken hat einen eigenen `--sp-x`/`--sp-y`-Vektor.
 */
function Sparkles() {
  const positions: Array<{ x: number; y: number; delay: number }> = [
    { x: -30, y: -30, delay: 0 },
    { x: 30, y: -30, delay: 150 },
    { x: -30, y: 30, delay: 300 },
    { x: 30, y: 30, delay: 450 },
  ];
  return (
    <>
      {positions.map((p, i) => (
        <span
          key={i}
          className="jass-sparkle"
          style={
            {
              left: "50%",
              top: "50%",
              "--sp-x": `${p.x}px`,
              "--sp-y": `${p.y}px`,
              animationDelay: `${p.delay}ms`,
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      ))}
    </>
  );
}
