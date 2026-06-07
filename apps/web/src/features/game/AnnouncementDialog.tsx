/**
 * Trumpf-Ansage-Dialog (Sprint C).
 *
 * Zeigt eine Auswahl:
 *   1. **TRUMPF** + Farbe (Eichel/Schelle/Herz/Laub)
 *   2. **GUMPF** + Farbe
 *   3. **OBEN**
 *   4. **UNTEN**
 *   5. **SLALOM** + Startmodus (OBEN/UNTEN)
 *   - „An Partner schieben" (Push) — nur wenn `canPush` true.
 *
 * UI-Strategie: Erste Klick wählt einen Mode-Card aus; bei TRUMPF/GUMPF/
 * SLALOM erscheint dann ein zweites Picker-Element (Trumpf-Farbe bzw.
 * Slalom-Startmodus). „Ansage bestätigen" sendet das Event.
 *
 * Wenn ich nicht der Ansager bin: der Dialog zeigt stattdessen
 * „Spieler X muss ansagen…" mit Spinner.
 */
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { announceConstraints, type PlayMode, type Suit } from "@jass/engine";

import type { AnnouncementDecision, PlayerView } from "./types";

interface Props {
  view: PlayerView;
  /** Sitz-Namen für die „Spieler X muss ansagen"-Anzeige. */
  seatNames: ReadonlyMap<number, string>;
  pending: boolean;
  onAnnounce: (decision: AnnouncementDecision) => void;
}

type ModeChoice = "TRUMPF" | "GUMPF" | "OBEN" | "UNTEN" | "SLALOM";

const SUITS: readonly { id: Suit; color: string }[] = [
  { id: "EICHEL", color: "bg-jass-brown text-jass-cream" },
  { id: "SCHELLE", color: "bg-jass-yellow text-jass-ink" },
  { id: "HERZ", color: "bg-jass-red text-jass-cream" },
  { id: "LAUB", color: "bg-jass-green text-jass-cream" },
];

export function AnnouncementDialog({ view, seatNames, pending, onAnnounce }: Props) {
  const { t } = useTranslation();
  const ann = view.announcement!;
  const [mode, setMode] = useState<ModeChoice | null>(null);
  const [trumpSuit, setTrumpSuit] = useState<Suit | null>(null);
  const [slalomStart, setSlalomStart] = useState<"OBEN" | "UNTEN">("OBEN");

  // Nur die an diesem Tisch erlaubten Ansage-Arten anbieten (Stufe vom Server).
  const { allowedModes, allowSlalom } = announceConstraints(ann.announceLevel);
  const visibleModes: ModeChoice[] = [
    ...(["TRUMPF", "GUMPF", "OBEN", "UNTEN"] as const).filter((m) => allowedModes.has(m)),
    ...(allowSlalom ? (["SLALOM"] as const) : []),
  ];

  if (!ann.iAmAnnouncer) {
    const name =
      seatNames.get(ann.announcerSeat) ?? t("game.seatFallback", { n: ann.announcerSeat });
    return (
      <div
        className="rounded-lg border border-jass-paperEdge bg-jass-cream p-6 text-center space-y-2"
        role="status"
        aria-live="polite"
      >
        <p className="text-jass-inkSoft text-sm">{t("game.announce.running")}</p>
        <p className="text-lg font-semibold text-jass-ink">
          <Trans
            i18nKey="game.announce.picking"
            values={{ name }}
            components={{ strong: <strong /> }}
          />
        </p>
        {ann.pushedFromSeat !== null && (
          <p className="text-xs text-jass-inkSoft">
            {t("game.announce.pushedFrom", {
              name:
                seatNames.get(ann.pushedFromSeat) ??
                t("game.seatFallback", { n: ann.pushedFromSeat }),
            })}
          </p>
        )}
      </div>
    );
  }

  // Schiebe-Slalom: der Partner hat Slalom angesagt — ich (Starter, komme mit
  // der ersten Karte raus) wähle nur noch die Start-Richtung (Oben/Unten).
  if (ann.slalomDirectionOnly) {
    return (
      <div className="rounded-lg border border-jass-paperEdge bg-jass-cream p-4 space-y-4">
        <header>
          <h3 className="font-semibold text-jass-ink">{t("game.announce.slalomDirectionTitle")}</h3>
          <p className="text-sm text-jass-inkSoft">{t("game.announce.slalomDirectionPrompt")}</p>
        </header>
        <div className="grid grid-cols-2 gap-2">
          {(["OBEN", "UNTEN"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlalomStart(s)}
              className={`rounded px-3 py-2 text-sm border ${
                slalomStart === s
                  ? "border-jass-yellowDark bg-jass-yellow text-jass-ink font-semibold"
                  : "border-jass-paperEdge bg-jass-paper text-jass-ink hover:bg-jass-cream"
              }`}
            >
              {s === "OBEN" ? t("game.announce.slalomOben") : t("game.announce.slalomUnten")}
            </button>
          ))}
        </div>
        <div className="flex border-t border-jass-paperEdge pt-3">
          <button
            type="button"
            onClick={() => onAnnounce({ kind: "announce", mode: slalomStart, slalom: true })}
            disabled={pending}
            className="ml-auto btn-jass-primary text-sm"
          >
            {pending ? t("game.announce.sending") : t("game.announce.confirm")}
          </button>
        </div>
      </div>
    );
  }

  function readyDecision(): AnnouncementDecision | null {
    if (mode === null) return null;
    if (mode === "TRUMPF" || mode === "GUMPF") {
      if (trumpSuit === null) return null;
      return { kind: "announce", mode: mode satisfies PlayMode, trumpSuit };
    }
    if (mode === "SLALOM") {
      return { kind: "announce", mode: slalomStart, slalom: true };
    }
    return { kind: "announce", mode: mode satisfies PlayMode };
  }

  const decision = readyDecision();
  const canConfirm = decision !== null && !pending;

  return (
    <div className="rounded-lg border border-jass-paperEdge bg-jass-cream p-4 space-y-4">
      <header>
        <h3 className="font-semibold text-jass-ink">{t("game.announce.title")}</h3>
        <p className="text-sm text-jass-inkSoft">
          {ann.pushedFromSeat !== null
            ? t("game.announce.pushedToYou", {
                name:
                  seatNames.get(ann.pushedFromSeat) ??
                  t("game.seatFallback", { n: ann.pushedFromSeat }),
              })
            : t("game.announce.chooseOrPush")}
        </p>
      </header>

      {/* Modus-Auswahl */}
      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wide text-jass-inkSoft">
          {t("game.announce.variant")}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {visibleModes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                if (m !== "TRUMPF" && m !== "GUMPF") setTrumpSuit(null);
              }}
              className={`rounded px-3 py-2 text-sm border ${
                mode === m
                  ? "border-jass-yellowDark bg-jass-yellow text-jass-ink font-semibold"
                  : "border-jass-paperEdge bg-jass-paper text-jass-ink hover:bg-jass-cream"
              }`}
            >
              {t(`game.announce.mode.${m}`)}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Trumpf-Farb-Picker bei TRUMPF/GUMPF */}
      {(mode === "TRUMPF" || mode === "GUMPF") && (
        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-jass-inkSoft">
            {t("game.announce.trumpSuit")}
          </legend>
          <div className="grid grid-cols-4 gap-2">
            {SUITS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setTrumpSuit(s.id)}
                className={`rounded px-2 py-2 text-sm font-medium border-2 ${
                  trumpSuit === s.id
                    ? `${s.color} border-jass-ink`
                    : "border-jass-paperEdge bg-jass-paper text-jass-ink hover:bg-jass-cream"
                }`}
              >
                {t(`game.announce.suit.${s.id}`)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* Slalom: Start-Modus — nur wenn ICH der Starter bin (nicht geschoben).
          Habe ich als gepushter Partner Slalom angesagt, wählt der Schieber
          (Vorhand) die Richtung im separaten slalomDirectionOnly-Schritt. */}
      {mode === "SLALOM" && ann.pushedFromSeat === null && (
        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-jass-inkSoft">
            {t("game.announce.slalomStartsWith")}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(["OBEN", "UNTEN"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlalomStart(s)}
                className={`rounded px-3 py-2 text-sm border ${
                  slalomStart === s
                    ? "border-jass-yellowDark bg-jass-yellow text-jass-ink font-semibold"
                    : "border-jass-paperEdge bg-jass-paper text-jass-ink hover:bg-jass-cream"
                }`}
              >
                {s === "OBEN" ? t("game.announce.slalomOben") : t("game.announce.slalomUnten")}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* Slalom nach Schieben: die Start-Richtung wählt der Schieber (Vorhand),
          nicht ich (gepushter Partner). */}
      {mode === "SLALOM" && ann.pushedFromSeat !== null && (
        <p className="text-xs text-jass-inkSoft">
          {t("game.announce.slalomPushHint", {
            name:
              seatNames.get(ann.pushedFromSeat) ??
              t("game.seatFallback", { n: ann.pushedFromSeat }),
          })}
        </p>
      )}

      {/* Aktionen */}
      <div className="flex gap-2 border-t border-jass-paperEdge pt-3">
        {ann.canPush && (
          <button
            type="button"
            onClick={() => onAnnounce({ kind: "push" })}
            disabled={pending}
            className="rounded border border-jass-paperEdge bg-jass-paper px-3 py-2 text-sm text-jass-ink hover:bg-jass-cream disabled:opacity-50"
          >
            {t("game.announce.push")}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (decision) onAnnounce(decision);
          }}
          disabled={!canConfirm}
          className="ml-auto btn-jass-primary text-sm"
        >
          {pending ? t("game.announce.sending") : t("game.announce.confirm")}
        </button>
      </div>
    </div>
  );
}
