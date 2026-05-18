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
 */
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
      className="grid grid-cols-3 grid-rows-3 gap-2 min-h-[12rem]"
      role="region"
      aria-label="Stich"
    >
      {cards.map((c, i) => {
        const absoluteSeat = (starter + i) % 4;
        const slot = relativeSlot(absoluteSeat, mySeat);
        const isWinner = winnerSeat !== undefined && absoluteSeat === winnerSeat;
        return (
          <div
            key={`${c.suit}-${c.rank}-${i}`}
            className={`${SLOT_POS[slot]} ${isWinner ? "ring-4 ring-amber-400 rounded-md" : ""}`}
          >
            <Card card={c} size="sm" />
          </div>
        );
      })}
    </div>
  );
}
