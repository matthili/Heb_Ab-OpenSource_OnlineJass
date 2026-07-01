/**
 * **WeisenResultOverlay** — wird nach Abschluss des ersten Spiels (Trick 1)
 * angezeigt. Backend signalisiert das über `weisen.result` in der PlayerView.
 *
 * Inhalt:
 *   - Header mit Sieger-Team-Markierung + Punkte
 *   - Pro Sitz: alle gemeldeten Deklarationen (Kind + Punkte + Karten)
 *   - „Weiter spielen"-Button, der das Overlay schließt
 *
 * **Position**: als `absolute inset-0` Backdrop über dem `GameBoard`-
 * Container — dadurch bleibt der Chat-Bereich rechts bedienbar (siehe
 * `DisconnectOverlay` für das gleiche Pattern).
 *
 * **Lifecycle**: Wir merken uns lokal, ob der User das Overlay schon
 * geschlossen hat (pro `gameId`). Beim Neuladen des Tabs (gleiche gameId)
 * würden wir sonst das Overlay erneut zeigen, was nervig wäre. State
 * hängt am `dismissedFor`-Set, das in `useWeisenResultDismiss` lebt.
 */
import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";

import type { SeatView } from "~/features/lobby/types";
import { seatDisplayName } from "./aiNames";
import type { WeisDeclarationView, WeisenView } from "./types";
import { kindLabel } from "./WeisenPanel";

// Mini-Card-Asset-Mapping. Wir rendern hier direkt ein `<img>` mit
// festem Sizing — die generische `Card`-Komponente aus @jass/ui hat
// `w-auto`, das ohne Wrapping-Container die intrinsische PNG-Breite
// annimmt (~600px). Im Result-Overlay wollen wir kompakte Briefmarken,
// also bypassen wir die generische Komponente.
const SUIT_FILE: Record<string, string> = {
  EICHEL: "eichel",
  SCHELLE: "schelle",
  HERZ: "herz",
  LAUB: "laub",
};
const RANK_FILE: Record<string, string> = {
  SECHS: "6",
  SIEBEN: "7",
  ACHT: "8",
  NEUN: "9",
  ZEHN: "10",
  UNTER: "U",
  OBER: "O",
  KOENIG: "K",
  ASS: "A",
};

function miniCardSrc(c: { suit: string; rank: string }): string {
  if (c.suit === "SCHELLE" && c.rank === "SECHS") return "/cards/schelle-6-weli.png";
  return `/cards/${SUIT_FILE[c.suit] ?? c.suit.toLowerCase()}-${RANK_FILE[c.rank] ?? c.rank}.png`;
}

interface Props {
  gameId: string;
  weisen: WeisenView;
  seats: readonly SeatView[];
  /** Eigene Sitz-Nummer — der Sitz wird mit „du" markiert. */
  mySeat: number;
  /** Seed für stabile KI-Namen (Tisch-ID). */
  nameSeed: string;
  /** Team-Zuordnung pro Sitz. Solo = [0,1,2,3] (jeder eigenes Team). */
  teams: readonly number[];
}

export function WeisenResultOverlay({ gameId, weisen, seats, mySeat, nameSeed, teams }: Props) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  // Wenn die gameId wechselt (z.B. nach Rematch), Dismiss-State zurücksetzen.
  useEffect(() => {
    setDismissed(false);
  }, [gameId]);

  if (!weisen.result || dismissed) return null;

  const { winningTeam, points, perSeat } = weisen.result;
  // Keine einzige Deklaration → Overlay weglassen (es gibt schlicht nichts
  // zu feiern). Server liefert in dem Fall `points: 0` + leeres perSeat.
  if (perSeat.length === 0) return null;

  // Solo: jeder Spieler ist sein eigenes „Team" ([0,1,2,3]) → wir zeigen
  // Namen statt „Team X". In Solo ist `winningTeam` der Gewinner-SITZ.
  const isSolo = new Set(teams).size === teams.length;

  const seatNames = new Map<number, string>();
  for (const s of seats) {
    seatNames.set(s.seat, seatDisplayName(s, nameSeed, t("game.seatFallback", { n: s.seat })));
  }
  const winnerName =
    winningTeam !== null
      ? (seatNames.get(winningTeam) ?? t("game.seatFallback", { n: winningTeam }))
      : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="weisen-result-title"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm rounded-jass p-4 overflow-y-auto"
    >
      <div className="max-w-xl w-full my-auto rounded-jass bg-jass-paper border border-jass-paperEdge shadow-xl p-5 space-y-4">
        <header className="text-center">
          <h2 id="weisen-result-title" className="text-xl font-bold text-jass-ink">
            {t("game.weisen.result.title")}
          </h2>
          {winningTeam !== null ? (
            <p className="mt-1 text-jass-inkSoft">
              <Trans
                i18nKey={isSolo ? "game.weisen.result.soloWins" : "game.weisen.result.teamWins"}
                values={
                  isSolo ? { name: winnerName, points } : { team: (winningTeam ?? 0) + 1, points }
                }
                components={{
                  strong: <strong className="text-jass-ink" />,
                  points: <span className="font-bold text-jass-green" />,
                }}
              />
            </p>
          ) : (
            <p className="mt-1 text-jass-inkSoft">{t("game.weisen.result.noneReported")}</p>
          )}
        </header>

        <ul className="space-y-3">
          {perSeat.map(({ seat, declarations }) => {
            // Team-Affiliation aus der echten Zuordnung lesen (KREUZ: 0/1,
            // Solo: jeder eigenes Team = Sitz). Früher hart `seat % 2`, was in
            // Solo falsch war.
            const teamOfSeat = teams[seat] ?? seat % 2;
            const isWinner = teamOfSeat === winningTeam;
            return (
              <li
                key={seat}
                className={`rounded-jass border p-3 ${
                  isWinner
                    ? "border-jass-yellowDark bg-jass-yellow/20"
                    : "border-jass-paperEdge bg-jass-cream"
                }`}
              >
                <div className="flex items-baseline justify-between mb-2">
                  <div className="font-semibold text-jass-ink">
                    {seatNames.get(seat) ?? t("game.seatFallback", { n: seat + 1 })}
                    {seat === mySeat && (
                      <span className="ml-1 text-xs text-jass-inkSoft">
                        {t("game.weisen.result.you")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-jass-inkSoft">
                    {!isSolo && t("game.weisen.result.team", { team: teamOfSeat + 1 })}
                    {isWinner && (
                      <span className="ml-2 text-jass-yellowDark font-bold">
                        {t("game.weisen.result.winner")}
                      </span>
                    )}
                  </div>
                </div>
                <ul className="space-y-2">
                  {declarations.map((d, i) => (
                    <DeclarationRow key={i} d={d} t={t} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded bg-jass-yellow border-2 border-jass-yellowDark px-4 py-2 text-sm font-bold text-jass-ink hover:bg-jass-yellow/90"
          >
            {t("game.weisen.result.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeclarationRow({ d, t }: { d: WeisDeclarationView; t: TFunction }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-wrap gap-1">
        {d.cards.map((c, i) => (
          // Mini-Card: feste Höhe 2.5rem, Breite proportional über
          // `w-auto` + `h-10` ist hier explizit beschränkt durch
          // `style={{ height: '2.5rem' }}` — Tailwind-Purging-sicher.
          <img
            key={i}
            src={miniCardSrc(c)}
            alt=""
            draggable={false}
            style={{ height: "2.5rem", width: "auto" }}
            className="rounded shadow-sm"
          />
        ))}
      </div>
      <div className="text-sm">
        <div className="font-semibold text-jass-ink">{kindLabel(d.kind, t)}</div>
        <div className="text-jass-inkSoft">{t("game.weisen.points", { points: d.points })}</div>
      </div>
    </div>
  );
}
