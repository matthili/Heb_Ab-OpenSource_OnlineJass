/**
 * Test-Helper für die Trumpf-Ansage-Phase (Sprint C).
 *
 * Existierende M4/M6-Integration-Tests treiben den Karten-Spielfluss direkt
 * über `GameService` (statt über das WS-Gateway). Seit Sprint C startet
 * jedes Spiel im Ansage-Modus — das alte Pattern „direkt Karten spielen"
 * würde dort hängen.
 *
 * Diese Hilfsfunktion wickelt die Ansage-Phase ab: KI-Sitze nutzen ihre
 * eigene `chooseAnnouncement`-Heuristik, User-Sitze sagen pragmatisch
 * TRUMPF/EICHEL an (egal welche Variante — die Tests verifizieren das
 * Verhalten, nicht die Strategie).
 *
 * Nach dem Aufruf ist das Spiel garantiert in der Playing-Phase oder das
 * Helper wirft einen Fehler, wenn nach maximal 3 Ansage-Schritten (Original
 * + Push + Partner-Ansage) immer noch ein Pending-State da ist.
 */
import type { TestAppHandle } from "./setup.js";

export async function settleAnnouncement(
  app: TestAppHandle,
  gameId: string,
  /** Wie sagt ein menschlicher Sitz an? Default: TRUMPF/EICHEL. */
  humanDecision: { mode: "TRUMPF"; trumpSuit: "EICHEL" } = {
    mode: "TRUMPF",
    trumpSuit: "EICHEL",
  }
): Promise<void> {
  for (let safety = 0; safety < 4; safety++) {
    const view = await app.games.viewForSeat(gameId, 0);
    if (view.status !== "announcing") return;

    const announcerSeat = view.announcement!.announcerSeat;
    const seatRow = await app.prisma.gameSeat.findUnique({
      where: { gameId_seat: { gameId, seat: announcerSeat } },
    });
    if (!seatRow) {
      throw new Error(`settleAnnouncement: GameSeat ${gameId}#${announcerSeat} fehlt`);
    }

    if (seatRow.userId === null && seatRow.aiSeatType !== null) {
      // KI-Sitz
      const decision = await app.games.aiChooseAnnouncement(gameId, announcerSeat);
      await app.games.applyAnnouncementAsSeat(gameId, announcerSeat, decision);
    } else {
      // User-Sitz: deterministisch TRUMPF/EICHEL ansagen.
      await app.games.applyAnnouncementAsSeat(gameId, announcerSeat, {
        kind: "announce",
        ...humanDecision,
      });
    }
  }
  throw new Error(`settleAnnouncement: nach 4 Schritten immer noch Ansage-Modus für ${gameId}`);
}
