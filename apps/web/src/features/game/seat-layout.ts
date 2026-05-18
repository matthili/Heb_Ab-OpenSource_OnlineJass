/**
 * Sitz-Position-Mapping (relative-Bildschirm-Slot) für die Sitz-Labels
 * der Mitspieler. Die Trick-Karten-Position macht jetzt direkt die
 * `@jass/ui`-Komponente `Trick`.
 *
 * **Drehrichtung**: Beim Jassen läuft alles **im Uhrzeigersinn**. Wenn
 * ich (Sitz 0) unten sitze, ist der nächste Spieler (Sitz 1) **links**
 * von mir, dann der Partner gegenüber, dann der dritte rechts.
 *
 *   Relative: 0 = unten (ich), 1 = links (nächster), 2 = oben (Partner),
 *             3 = rechts (vorheriger)
 */

export type ScreenSlot = "bottom" | "left" | "top" | "right";

const SLOTS: readonly ScreenSlot[] = ["bottom", "left", "top", "right"];

export function relativeSlot(absoluteSeat: number, mySeat: number): ScreenSlot {
  const idx = (((absoluteSeat - mySeat) % 4) + 4) % 4;
  return SLOTS[idx]!;
}

/** Tailwind-Klassen für die Mitspieler-Avatare je nach Slot. */
export const SEAT_LABEL_POS: Record<ScreenSlot, string> = {
  bottom: "row-start-3 col-start-2 self-end justify-self-center",
  right: "row-start-2 col-start-3 self-center justify-self-end translate-x-2",
  top: "row-start-1 col-start-2 self-start justify-self-center",
  left: "row-start-2 col-start-1 self-center justify-self-start -translate-x-2",
};
