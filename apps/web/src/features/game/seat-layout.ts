/**
 * Sitz-Position-Mapping (relative-Bildschirm-Slot) für die Sitz-Labels
 * der Mitspieler. Die Trick-Karten-Position macht jetzt direkt die
 * `@jass/ui`-Komponente `Trick`.
 *
 *   Relative: 0 = unten (ich), 1 = rechts, 2 = oben, 3 = links
 */

export type ScreenSlot = "bottom" | "right" | "top" | "left";

const SLOTS: readonly ScreenSlot[] = ["bottom", "right", "top", "left"];

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
