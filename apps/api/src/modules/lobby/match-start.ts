/**
 * Ansager-Bestimmung für die **erste Hand einer NEUEN Partie** (Match-Start).
 *
 * Greift nur bei `restartMode = "SIEGER_GIBT"`. Regel „Sieger gibt, Verlierer
 * fängt an" mit **Geber-Rotation**: Der nächste Sitz im Uhrzeigersinn nach dem
 * letzten Geber, der zum **Sieger-Team** gehört, gibt; der Spieler danach (ein
 * Verlierer) ist Vorhand/Ansager.
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
 * @param lastStarter  Ansager der letzten Hand der beendeten Partie (daraus
 *                     leiten wir den letzten Geber ab: `(lastStarter-1) mod n`).
 */
export function matchStartAnnouncerSiegerGibt(
  variant: string,
  cumulative: readonly number[],
  lastStarter: number
): number {
  const seatCount = seatCountFor(variant);
  const numTeams = variant === "SOLO_4P" ? 4 : 2;

  // Sieger-Team = höchster kumulativer Punktestand.
  let winnerTeam = 0;
  for (let t = 1; t < numTeams; t++) {
    if ((cumulative[t] ?? 0) > (cumulative[winnerTeam] ?? 0)) winnerTeam = t;
  }

  // Letzter Geber = ein Sitz vor dem letzten Ansager (im Uhrzeigersinn).
  const lastDealer = (lastStarter - 1 + seatCount) % seatCount;

  // Nächster Sitz im Uhrzeigersinn nach dem letzten Geber, der zum Sieger-Team
  // gehört, ist der neue Geber.
  let newDealer = lastDealer;
  for (let i = 1; i <= seatCount; i++) {
    const candidate = (lastDealer + i) % seatCount;
    if (teamOfSeat(variant, candidate) === winnerTeam) {
      newDealer = candidate;
      break;
    }
  }

  // Vorhand/Ansager = der Spieler nach dem Geber (ein Verlierer).
  return (newDealer + 1) % seatCount;
}
