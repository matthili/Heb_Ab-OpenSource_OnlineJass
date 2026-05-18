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
import type { PlayMode, Suit } from "@jass/engine";

import type { AnnouncementDecision, PlayerView } from "./types";

interface Props {
  view: PlayerView;
  /** Sitz-Namen für die „Spieler X muss ansagen"-Anzeige. */
  seatNames: ReadonlyMap<number, string>;
  pending: boolean;
  onAnnounce: (decision: AnnouncementDecision) => void;
}

type ModeChoice = "TRUMPF" | "GUMPF" | "OBEN" | "UNTEN" | "SLALOM";

const SUITS: readonly { id: Suit; label: string; color: string }[] = [
  { id: "EICHEL", label: "Eichel", color: "bg-jass-brown text-jass-cream" },
  { id: "SCHELLE", label: "Schelle", color: "bg-jass-yellow text-jass-ink" },
  { id: "HERZ", label: "Herz", color: "bg-jass-red text-jass-cream" },
  { id: "LAUB", label: "Laub", color: "bg-jass-green text-jass-cream" },
];

export function AnnouncementDialog({ view, seatNames, pending, onAnnounce }: Props) {
  const ann = view.announcement!;
  const [mode, setMode] = useState<ModeChoice | null>(null);
  const [trumpSuit, setTrumpSuit] = useState<Suit | null>(null);
  const [slalomStart, setSlalomStart] = useState<"OBEN" | "UNTEN">("OBEN");

  if (!ann.iAmAnnouncer) {
    const name = seatNames.get(ann.announcerSeat) ?? `Sitz ${ann.announcerSeat}`;
    return (
      <div
        className="rounded-lg border border-jass-paperEdge bg-jass-cream p-6 text-center space-y-2"
        role="status"
        aria-live="polite"
      >
        <p className="text-jass-inkSoft text-sm">Trumpf-Ansage läuft</p>
        <p className="text-lg font-semibold text-jass-ink">
          <strong>{name}</strong> wählt die Variante…
        </p>
        {ann.pushedFromSeat !== null && (
          <p className="text-xs text-jass-inkSoft">
            {seatNames.get(ann.pushedFromSeat) ?? `Sitz ${ann.pushedFromSeat}`} hat geschoben.
          </p>
        )}
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
        <h3 className="font-semibold text-jass-ink">Du musst ansagen.</h3>
        <p className="text-sm text-jass-inkSoft">
          {ann.pushedFromSeat !== null
            ? `${seatNames.get(ann.pushedFromSeat) ?? `Sitz ${ann.pushedFromSeat}`} hat an dich geschoben — du musst wählen.`
            : "Such dir eine Variante aus, oder schiebe an deinen Partner."}
        </p>
      </header>

      {/* Modus-Auswahl */}
      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-wide text-jass-inkSoft">Variante</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["TRUMPF", "GUMPF", "OBEN", "UNTEN", "SLALOM"] as const).map((m) => (
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
              {m === "TRUMPF" && "Trumpf"}
              {m === "GUMPF" && "Gumpf"}
              {m === "OBEN" && "Oben (Bock)"}
              {m === "UNTEN" && "Unten (Geiss)"}
              {m === "SLALOM" && "Slalom"}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Trumpf-Farb-Picker bei TRUMPF/GUMPF */}
      {(mode === "TRUMPF" || mode === "GUMPF") && (
        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-jass-inkSoft">
            Trumpf-Farbe
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
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* Slalom: Start-Modus */}
      {mode === "SLALOM" && (
        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-jass-inkSoft">
            Slalom startet mit
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
                {s === "OBEN" ? "Oben → Unten → Oben …" : "Unten → Oben → Unten …"}
              </button>
            ))}
          </div>
        </fieldset>
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
            An Partner schieben
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (decision) onAnnounce(decision);
          }}
          disabled={!canConfirm}
          className="ml-auto rounded bg-jass-ink px-4 py-2 text-sm text-jass-cream hover:bg-jass-brownDark disabled:opacity-40"
        >
          {pending ? "Sende…" : "Ansage bestätigen"}
        </button>
      </div>
    </div>
  );
}
