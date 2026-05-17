/**
 * Sitz-Position-Mapping: absolute Sitz-Nummer (0..3, vom Server) → relative
 * Bildschirm-Position (vom eigenen Sitz aus betrachtet).
 *
 *   Relative: 0 = unten (ich), 1 = rechts, 2 = oben, 3 = links
 *
 * Bei Kreuz-Jass sitzen Teams überkreuz: ich (0) + gegenüber (2) sind ein
 * Team, rechts (1) + links (3) das andere.
 */

export type ScreenSlot = "bottom" | "right" | "top" | "left";

const SLOTS: readonly ScreenSlot[] = ["bottom", "right", "top", "left"];

export function relativeSlot(absoluteSeat: number, mySeat: number): ScreenSlot {
  const idx = (((absoluteSeat - mySeat) % 4) + 4) % 4;
  return SLOTS[idx]!;
}

/** Tailwind-Klassen für die Trick-Karten je nach Slot. */
export const TRICK_SLOT_POS: Record<ScreenSlot, string> = {
  bottom: "row-start-3 col-start-2 self-end justify-self-center",
  right: "row-start-2 col-start-3 self-center justify-self-end",
  top: "row-start-1 col-start-2 self-start justify-self-center",
  left: "row-start-2 col-start-1 self-center justify-self-start",
};

/** Tailwind-Klassen für die Mitspieler-Avatare je nach Slot. */
export const SEAT_LABEL_POS: Record<ScreenSlot, string> = {
  bottom: "row-start-4 col-start-2 self-end justify-self-center",
  right: "row-start-2 col-start-3 self-center justify-self-end translate-x-full pl-3",
  top: "row-start-1 col-start-2 self-start justify-self-center",
  left: "row-start-2 col-start-1 self-center justify-self-start -translate-x-full pr-3",
};
