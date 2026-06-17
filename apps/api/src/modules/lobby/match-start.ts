/**
 * Ansager-Bestimmung für die **erste Hand einer NEUEN Partie** (Match-Start).
 *
 * Greift nur bei `restartMode = "SIEGER_GIBT"`. Vorarlberger Regel „Sieger gibt":
 * Neuer **Geber** = der **letzte Spieler des Sieger-Teams, der im Schluss-Stich
 * eine Karte geworfen hat** (Wurf-Reihenfolge ab Stich-Starter im Uhrzeigersinn);
 * **Ansager** = der Spieler nach dem Geber (zwangsläufig Verlierer-Team). So ist
 * „Sieger gibt, Verlierer sagt an" erfüllt und Geber ≠ Ansager. Ohne bekannten
 * Schluss-Stich (`finalTrickStarter` undefined) → Fallback auf Geber-Rotation
 * zum nächsten Sieger-Team-Sitz im Uhrzeigersinn nach dem letzten Geber.
 *
 * Innerhalb eines Matches rotiert der Ansager dagegen einfach im Uhrzeigersinn
 * (siehe `evaluateRematchVotes`); WELI bestimmt den Ansager nur, wenn der Tisch
 * auf `restartMode = "WELI"` steht — dann wird diese Funktion gar nicht erst
 * aufgerufen.
 */

/** Sitzanzahl je Variante (Bodensee 2, sonst 4). */
function seatCountFor(variant: string): number {
  return variant === "BODENSEE_2P" ? 2 : 4;
}

/**
 * Sitz → Team. Solo: jeder Sitz ist sein eigenes Team. Kreuz: Sitze 0/2 = Team
 * 0, 1/3 = Team 1. Bodensee: Sitz 0 = Team 0, Sitz 1 = Team 1.
 */
function teamOfSeat(variant: string, seat: number): number {
  if (variant === "SOLO_4P") return seat;
  return seat % 2;
}

/**
 * Liefert den Sitz des Ansagers für die erste Hand der neuen Partie.
 *
 * @param variant      DB-Variant ("KREUZ_4P" | "SOLO_4P" | "BODENSEE_2P" | …)
 * @param cumulative   Match-Endstände als [Team0, Team1, Team2, Team3]. Bei
 *                     Kreuz/Bodensee zählen nur Index 0/1, bei Solo 0..3.
 * @param lastStarter  Ansager der letzten Hand der beendeten Partie. Nur für den
 *                     Fallback (Geber = `(lastStarter-1) mod n`).
 * @param finalTrickStarter  Sitz, der den **Schluss-Stich** der letzten Hand
 *                     angespielt hat (= dessen Wurf-Reihenfolge). Liegt er vor,
 *                     greift die exakte Regel; sonst der Rotations-Fallback.
 */
export function matchStartAnnouncerSiegerGibt(
  variant: string,
  cumulative: readonly number[],
  lastStarter: number,
  finalTrickStarter?: number
): number {
  const seatCount = seatCountFor(variant);
  const numTeams = variant === "SOLO_4P" ? 4 : 2;

  // Sieger-Team = höchster kumulativer Punktestand.
  let winnerTeam = 0;
  for (let t = 1; t < numTeams; t++) {
    if ((cumulative[t] ?? 0) > (cumulative[winnerTeam] ?? 0)) winnerTeam = t;
  }

  // Exakte Regel: Geber = der LETZTE Sieger-Team-Sitz in der Wurf-Reihenfolge
  // des Schluss-Stichs (Starter, dann im Uhrzeigersinn). Von hinten durchgehen
  // → der erste Treffer ist der zuletzt werfende Sieger-Team-Spieler.
  if (finalTrickStarter !== undefined) {
    for (let i = seatCount - 1; i >= 0; i--) {
      const seat = (finalTrickStarter + i) % seatCount;
      if (teamOfSeat(variant, seat) === winnerTeam) {
        return (seat + 1) % seatCount; // Ansager = der Spieler nach dem Geber
      }
    }
  }

  // Fallback (kein Schluss-Stich bekannt, z.B. fehlende Move-Daten): Geber-
  // Rotation zum nächsten Sieger-Team-Sitz im Uhrzeigersinn nach dem letzten
  // Geber (= ein Sitz vor dem letzten Ansager).
  const lastDealer = (lastStarter - 1 + seatCount) % seatCount;
  let newDealer = lastDealer;
  for (let i = 1; i <= seatCount; i++) {
    const candidate = (lastDealer + i) % seatCount;
    if (teamOfSeat(variant, candidate) === winnerTeam) {
      newDealer = candidate;
      break;
    }
  }
  return (newDealer + 1) % seatCount;
}
