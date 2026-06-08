/**
 * Bodensee-Spielfläche — die 2-Spieler-Variante.
 *
 * Layout (von oben nach unten):
 *   - Status-Leiste: Stich-Zähler, Modus/Trumpf, Punkte
 *   - Gegner-Bereich: verdeckte Hand + Tisch-Stapel (offene Karte mit „+1",
 *     wenn an dieser Position noch eine verdeckte darunter liegt) — nicht klickbar
 *   - Stich-Mitte: laufender Stich, sonst der zuletzt abgeschlossene
 *   - Eigener Bereich: eigene 6 Tisch-Stapel + Hand (klickbar bei Zug)
 *   - Ansage-Panel (Phase `announcing`) bzw. End-Overlay (`finished`)
 *
 * Spielbar ist der „Pool": Handkarten + sichtbare Tisch-Karten. Welche
 * Karte legal ist, sagt `legalActionMask` (36-Bit, Index = `cardIndex`).
 */
import {
  announceConstraints,
  cardIndex,
  type AnnounceLevel,
  type Card as CardModel,
  type PlayMode,
  type Suit,
} from "@jass/engine";
import { Card } from "@jass/ui";
import type { TFunction } from "i18next";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { seatDisplayName } from "~/features/game/aiNames";
import { AnnounceOverlay, ModeWatermark } from "~/features/game/AnnounceVisuals";
import type { SeatView } from "~/features/lobby/types";
import type { BodenseeAnnouncement, BodenseeView } from "./types";
import { useBodenseeTrickLinger } from "./useBodenseeTrickLinger";

interface Props {
  view: BodenseeView;
  seats: SeatView[];
  movePending: boolean;
  announcePending: boolean;
  error: string | null;
  /** Seed für stabile KI-Namen (Tisch-ID, konstant über die Partie). */
  nameSeed: string;
  onPlayCard: (card: CardModel) => void;
  onAnnounce: (announcement: BodenseeAnnouncement) => void;
}

// Für nicht-klickbare Stapel (Gegner-Tisch): nie legal, kein Klick-Handler.
const NEVER_LEGAL = (_c: CardModel): boolean => false;
const NOOP_PLAY = (_c: CardModel): void => {};

/** Übersetzt eine Farbe über den geteilten `game.announce.suit.*`-Namespace. */
function suitLabel(t: TFunction, suit: Suit): string {
  return t(`game.announce.suit.${suit}`);
}

/**
 * Übersetzt einen Spielmodus über den geteilten `game.announce.mode.*`-Namespace.
 * `PlayMode | "SLALOM"`, weil das Ansage-Panel zusätzlich Slalom anbietet — der
 * `mode.*`-Namespace deckt alle fünf Werte ab.
 */
function modeLabel(t: TFunction, mode: PlayMode | "SLALOM"): string {
  return t(`game.announce.mode.${mode}`);
}

function cardKey(c: CardModel): string {
  return `${c.suit}-${c.rank}`;
}

export function BodenseeBoard({
  view,
  seats,
  movePending,
  announcePending,
  error,
  nameSeed,
  onPlayCard,
  onAnnounce,
}: Props) {
  const { t } = useTranslation();
  const oppSeat = 1 - view.mySeat;
  const seatName = (seat: number): string => {
    const fallback = t("game.seatFallback", { n: seat + 1 });
    const s = seats.find((x) => x.seat === seat);
    return s ? seatDisplayName(s, nameSeed, fallback) : fallback;
  };

  const isLegal = (c: CardModel): boolean => view.legalActionMask[cardIndex(c)] === 1;
  const canPlay = view.status === "playing" && view.myTurn && !movePending;

  // Gerade fertigen Stich ~1,8 s „eingefroren" zeigen (wer hat gestochen?),
  // auch wenn der nächste Stich schon startet.
  const lingerTrick = useBodenseeTrickLinger(view);

  // Stabile Ansage-Info (für Overlay + Wasserzeichen). Erst ab `playing` gesetzt.
  const announceInfo =
    view.playMode !== undefined
      ? { mode: view.playMode, trumpSuit: view.trumpSuit, slalom: view.slalom ?? false }
      : null;

  return (
    <div className="space-y-3 relative">
      {announceInfo && <AnnounceOverlay gameId={view.gameId} info={announceInfo} />}
      {/* Status-Leiste */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-jass-paperEdge bg-jass-cream px-4 py-2 text-sm">
        <span className="text-jass-inkSoft">
          <Trans
            i18nKey="bodensee.status.trick"
            values={{ n: Math.min(view.trickIdx + 1, 18) }}
            components={{ strong: <strong className="text-jass-ink" /> }}
          />
        </span>
        <span className="jass-mode-glow rounded bg-jass-yellow px-2.5 py-1 text-sm font-bold text-jass-ink ring-1 ring-jass-yellowDark">
          {t("bodensee.status.mode", {
            mode: view.slalom
              ? t("game.announce.mode.SLALOM")
              : view.playMode
                ? modeLabel(t, view.playMode)
                : "—",
          })}
          {!view.slalom && view.trumpSuit ? ` ${suitLabel(t, view.trumpSuit)}` : ""}
        </span>
        <span className="text-jass-inkSoft">
          <Trans
            i18nKey="bodensee.status.score"
            values={{ own: view.ownScore, opp: view.oppScore, name: seatName(oppSeat) }}
            components={{ strong: <strong className="text-jass-ink" /> }}
          />
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded bg-rose-50 border border-rose-300 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </p>
      )}

      {/* Gegner-Bereich */}
      <section className="rounded-lg border border-jass-paperEdge bg-jass-paper p-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-jass-ink">{seatName(oppSeat)}</span>
          <span className="text-jass-inkSoft">
            {t("bodensee.opponent.handAndHidden", {
              hand: view.opponentHandCount,
              hidden: view.opponentTable.filter((s) => s.hasHidden).length,
            })}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-1">
          {Array.from({ length: view.opponentHandCount }).map((_, i) => (
            <FaceDownCard key={`oh-${i}`} size="xs" />
          ))}
        </div>
        {view.opponentTable.some((s) => s.visible !== null || s.hasHidden) && (
          <div className="flex flex-wrap items-end gap-1.5 border-t border-jass-paperEdge pt-2">
            {view.opponentTable.map((stack, i) => (
              <TableStackSlot
                key={`opp-stack-${i}`}
                stack={stack}
                playable={false}
                isLegal={NEVER_LEGAL}
                onPlay={NOOP_PLAY}
              />
            ))}
          </div>
        )}
      </section>

      {/* Stich-Mitte — mit Modus-Wasserzeichen dahinter (gut sichtbar statt
          des zu kleinen Icons oben). */}
      <section className="relative min-h-[10rem] overflow-hidden rounded-xl bg-emerald-800 px-4 py-5 text-center text-emerald-50 shadow-inner">
        {announceInfo && <ModeWatermark info={announceInfo} currentMode={view.playMode} />}
        <div className="relative z-10">
          <TrickArea view={view} seatName={seatName} lingerTrick={lingerTrick} />
        </div>
      </section>

      {/* Erster + letzter abgeschlossener Stich als Minis (wie regulär) */}
      {(view.firstTrick || view.lastTrick) && (
        <section className="flex justify-center gap-4">
          {view.firstTrick && (
            <MiniTrick
              label={t("game.trickMini.first")}
              trick={view.firstTrick}
              mySeat={view.mySeat}
              seatName={seatName}
              t={t}
            />
          )}
          {view.lastTrick && (
            <MiniTrick
              label={t("game.trickMini.last")}
              trick={view.lastTrick}
              mySeat={view.mySeat}
              seatName={seatName}
              t={t}
            />
          )}
        </section>
      )}

      {/* Eigener Bereich */}
      <section className="rounded-lg border border-jass-paperEdge bg-jass-paper p-3 space-y-3">
        <div className="text-sm">
          {view.status === "playing" &&
            (view.myTurn ? (
              <span className="font-semibold text-emerald-700">{t("bodensee.turn.you")}</span>
            ) : (
              <span className="text-jass-inkSoft">
                {t("bodensee.turn.other", { name: seatName(oppSeat) })}
              </span>
            ))}
        </div>

        {/* Eigene Tisch-Stapel */}
        <div>
          <p className="text-xs uppercase tracking-wide text-jass-inkSoft mb-1">
            {t("bodensee.yourTable")}
          </p>
          <div className="flex flex-wrap items-end gap-1.5">
            {view.ownTable.map((stack, i) => (
              <TableStackSlot
                key={`my-stack-${i}`}
                stack={stack}
                playable={canPlay}
                isLegal={isLegal}
                onPlay={onPlayCard}
              />
            ))}
          </div>
        </div>

        {/* Eigene Hand */}
        <div>
          <p className="text-xs uppercase tracking-wide text-jass-inkSoft mb-1">
            {t("bodensee.yourHand")}
          </p>
          <div className="flex flex-wrap items-end gap-1.5">
            {view.hand.length === 0 && (
              <span className="text-sm text-jass-inkSoft italic">{t("bodensee.noHandCards")}</span>
            )}
            {/* Aufsteigend nach Farbe dann Rang sortiert (cardIndex = SUIT_ID*9 +
                RANK_ID) — gleiches Bild wie der <Hand>-Fan der anderen Varianten.
                Die Tisch-Stapel bleiben dagegen in Austeil-Reihenfolge. */}
            {[...view.hand]
              .sort((a, b) => cardIndex(a) - cardIndex(b))
              .map((c) => {
                const legal = isLegal(c);
                return (
                  <Card
                    key={cardKey(c)}
                    card={c}
                    size="md"
                    {...(canPlay && legal ? { onClick: onPlayCard } : {})}
                    disabled={canPlay && !legal}
                  />
                );
              })}
          </div>
        </div>
      </section>

      {/* Ansage-Phase */}
      {view.status === "announcing" &&
        (view.announcement?.iAmAnnouncer ? (
          <AnnouncePanel
            pending={announcePending}
            onAnnounce={onAnnounce}
            announceLevel={view.announcement.announceLevel}
          />
        ) : (
          <p className="rounded-lg border border-jass-paperEdge bg-jass-cream px-4 py-3 text-sm text-jass-inkSoft">
            {t("bodensee.announce.otherChoosing", {
              name: seatName(view.announcement?.announcerSeat ?? oppSeat),
            })}
          </p>
        ))}

      {/* End-Overlay */}
      {view.status === "finished" && view.finalScore && (
        <FinishedPanel view={view} oppName={seatName(oppSeat)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stich-Mitte
// ─────────────────────────────────────────────────────────────────────

function TrickArea({
  view,
  seatName,
  lingerTrick,
}: {
  view: BodenseeView;
  seatName: (seat: number) => string;
  lingerTrick: NonNullable<BodenseeView["lastTrick"]> | null;
}) {
  const { t } = useTranslation();

  // 1) Linger: gerade fertiger Stich „eingefroren" (Vorrang vor dem schon
  //    laufenden nächsten Stich) — beide Karten + „… hat gestochen".
  if (lingerTrick) {
    return (
      <CompletedTrickView trick={lingerTrick} mySeat={view.mySeat} seatName={seatName} emphasised />
    );
  }

  // 2) Laufender Stich.
  const live = view.currentTrick;
  if (live.cards.length > 0) {
    return (
      <div>
        <p className="text-xs uppercase tracking-wide text-emerald-200 mb-2">
          {t("bodensee.trick.running")}
        </p>
        <div className="flex items-end justify-center gap-4">
          {live.cards.map((c, i) => {
            const seat = i === 0 ? live.starter : 1 - live.starter;
            return (
              <div key={`ct-${i}`} className="space-y-1">
                <Card card={c} size="md" />
                <p className="text-xs text-emerald-100">
                  {seat === view.mySeat ? t("game.you") : seatName(seat)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 3) Idle: zuletzt abgeschlossener Stich (bis der nächste startet).
  if (view.lastTrick) {
    return (
      <CompletedTrickView
        trick={view.lastTrick}
        mySeat={view.mySeat}
        seatName={seatName}
        emphasised={false}
      />
    );
  }

  // 4) Noch kein Stich.
  return <p className="text-sm text-emerald-100">{t("bodensee.trick.starting")}</p>;
}

/**
 * Ein abgeschlossener Stich (beide Karten + „… hat gestochen"). Der Gewinner
 * kommt vom Server (`trick.winner`) — keine Client-Berechnung, also kein
 * Slalom-Risiko. `emphasised` (Linger-Moment): volle Deckkraft + Gold-Ring
 * um die Sieger-Karte; sonst leicht gedimmt (reine Wartedarstellung).
 */
function CompletedTrickView({
  trick,
  mySeat,
  seatName,
  emphasised,
}: {
  trick: NonNullable<BodenseeView["lastTrick"]>;
  mySeat: number;
  seatName: (seat: number) => string;
  emphasised: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="text-sm uppercase tracking-wide text-emerald-100 mb-2 font-semibold">
        {trick.winner === mySeat
          ? t("bodensee.trick.lastWonByYou")
          : t("bodensee.trick.lastWonByOther", { name: seatName(trick.winner) })}
      </p>
      <div className={`flex items-end justify-center gap-4 ${emphasised ? "" : "opacity-80"}`}>
        {trick.cards.map((c, i) => {
          const seat = i === 0 ? trick.starter : 1 - trick.starter;
          const isWinnerCard = seat === trick.winner;
          return (
            <div key={`ct-done-${i}`} className="space-y-1">
              <div
                className={
                  isWinnerCard && emphasised
                    ? "rounded-lg ring-2 ring-jass-yellow ring-offset-1"
                    : ""
                }
              >
                <Card card={c} size="md" />
              </div>
              <p className="text-xs text-emerald-100">
                {seat === mySeat ? t("game.you") : seatName(seat)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stich-Mini (erster / letzter abgeschlossener Stich)
// ─────────────────────────────────────────────────────────────────────

function MiniTrick({
  label,
  trick,
  mySeat,
  seatName,
  t,
}: {
  label: string;
  trick: { cards: readonly CardModel[]; starter: number; winner: number };
  mySeat: number;
  seatName: (seat: number) => string;
  t: TFunction;
}) {
  return (
    <div className="rounded-lg border border-jass-paperEdge bg-jass-cream px-3 py-2 text-center">
      <p className="text-xs uppercase tracking-wide text-jass-inkSoft">{label}</p>
      <div className="my-1 flex justify-center gap-1">
        {trick.cards.map((c, i) => (
          <Card key={`${c.suit}-${c.rank}-${i}`} card={c} size="sm" />
        ))}
      </div>
      <p className="text-xs text-jass-inkSoft">
        {trick.winner === mySeat
          ? t("game.trickMini.wonByYou")
          : t("game.trickMini.wonByName", { name: seatName(trick.winner) })}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tisch-Stapel
// ─────────────────────────────────────────────────────────────────────

function TableStackSlot({
  stack,
  playable,
  isLegal,
  onPlay,
}: {
  stack: BodenseeView["ownTable"][number];
  playable: boolean;
  isLegal: (c: CardModel) => boolean;
  onPlay: (c: CardModel) => void;
}) {
  const { t } = useTranslation();
  if (!stack.visible) {
    // Leerer Stapel-Platzhalter — gleiche Größe wie eine `md`-Karte (= Handkarte).
    return (
      <div className="h-32 w-[5.4rem] rounded-md border border-dashed border-jass-paperEdge bg-jass-cream/50" />
    );
  }
  const legal = isLegal(stack.visible);
  return (
    <div className="relative">
      <Card
        card={stack.visible}
        size="md"
        {...(playable && legal ? { onClick: onPlay } : {})}
        disabled={playable && !legal}
      />
      {stack.hasHidden && (
        <span
          className="absolute -bottom-1 -right-1 rounded-full bg-jass-yellow px-1.5 py-0.5 text-[10px] font-bold text-jass-brownDark ring-1 ring-jass-brownDark"
          title={t("bodensee.hiddenBelow")}
        >
          +1
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Verdeckte Karte
// ─────────────────────────────────────────────────────────────────────

function FaceDownCard({ size }: { size: "xs" | "sm" }) {
  const cls = size === "xs" ? "h-14 w-9" : "h-24 w-16";
  return (
    <div
      className={`${cls} rounded-md border border-jass-brownDark bg-gradient-to-br from-jass-brownDark to-stone-700 shadow`}
      aria-hidden="true"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Ansage-Panel
// ─────────────────────────────────────────────────────────────────────

type AnnounceMode = "TRUMPF" | "GUMPF" | "OBEN" | "UNTEN" | "SLALOM";

const SUITS: readonly Suit[] = ["EICHEL", "SCHELLE", "HERZ", "LAUB"];

function AnnouncePanel({
  pending,
  onAnnounce,
  announceLevel,
}: {
  pending: boolean;
  onAnnounce: (a: BodenseeAnnouncement) => void;
  announceLevel: AnnounceLevel;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AnnounceMode>("TRUMPF");
  const [suit, setSuit] = useState<Suit>("EICHEL");
  const [slalomStart, setSlalomStart] = useState<"OBEN" | "UNTEN">("OBEN");
  const needsSuit = mode === "TRUMPF" || mode === "GUMPF";

  // Nur die an diesem Tisch erlaubten Ansage-Arten anbieten.
  const { allowedModes, allowSlalom } = announceConstraints(announceLevel);
  const visibleModes: AnnounceMode[] = [
    ...(["TRUMPF", "GUMPF", "OBEN", "UNTEN"] as const).filter((m) => allowedModes.has(m)),
    ...(allowSlalom ? (["SLALOM"] as const) : []),
  ];

  function confirm() {
    if (mode === "SLALOM") {
      // Ansager = Vorhand (kommt raus) → wählt selbst den Startmodus.
      onAnnounce({ variant: { mode: slalomStart }, slalom: true });
      return;
    }
    if (needsSuit) {
      onAnnounce({ variant: { mode, trump_suit: suit }, slalom: false });
      return;
    }
    onAnnounce({ variant: { mode }, slalom: false });
  }

  return (
    <section className="rounded-lg border-2 border-jass-yellowDark bg-jass-yellow/15 p-4 space-y-3">
      <h3 className="font-semibold text-jass-ink">{t("bodensee.announce.title")}</h3>
      <div className="flex flex-wrap gap-2">
        {visibleModes.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              mode === m
                ? "border-jass-yellowDark bg-jass-yellow font-semibold text-jass-ink"
                : "border-jass-paperEdge bg-jass-cream text-jass-inkSoft hover:bg-jass-yellow/20"
            }`}
          >
            {modeLabel(t, m)}
          </button>
        ))}
      </div>
      {needsSuit && (
        <div className="flex flex-wrap gap-2">
          {SUITS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSuit(s)}
              aria-pressed={suit === s}
              className={`rounded border px-3 py-1 text-sm transition ${
                suit === s
                  ? "border-jass-yellowDark bg-jass-yellow font-semibold text-jass-ink"
                  : "border-jass-paperEdge bg-jass-cream text-jass-inkSoft hover:bg-jass-yellow/20"
              }`}
            >
              {suitLabel(t, s)}
            </button>
          ))}
        </div>
      )}
      {mode === "SLALOM" && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-jass-inkSoft">
            {t("game.announce.slalomStartsWith")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["OBEN", "UNTEN"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlalomStart(s)}
                aria-pressed={slalomStart === s}
                className={`rounded border px-3 py-1 text-sm transition ${
                  slalomStart === s
                    ? "border-jass-yellowDark bg-jass-yellow font-semibold text-jass-ink"
                    : "border-jass-paperEdge bg-jass-cream text-jass-inkSoft hover:bg-jass-yellow/20"
                }`}
              >
                {s === "OBEN" ? t("game.announce.slalomOben") : t("game.announce.slalomUnten")}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={confirm}
        disabled={pending}
        className="btn-jass-primary disabled:opacity-50"
      >
        {pending ? t("bodensee.announce.sending") : t("bodensee.announce.submit")}
      </button>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// End-Overlay
// ─────────────────────────────────────────────────────────────────────

function FinishedPanel({ view, oppName }: { view: BodenseeView; oppName: string }) {
  const { t } = useTranslation();
  const points = view.finalScore!.player_total_points;
  const mine = points[view.mySeat] ?? 0;
  const theirs = points[1 - view.mySeat] ?? 0;
  const iWon = mine > theirs;
  const draw = mine === theirs;
  const matschMe = view.finalScore!.matsch_player === view.mySeat;

  return (
    <section className="rounded-lg border-2 border-jass-yellowDark bg-jass-yellow/20 p-4 text-center space-y-1">
      <h3 className="text-lg font-bold text-jass-ink">
        {draw
          ? t("bodensee.finished.draw")
          : iWon
            ? t("bodensee.finished.youWon")
            : t("bodensee.finished.otherWon", { name: oppName })}
      </h3>
      <p className="text-jass-ink">
        <Trans
          i18nKey="bodensee.finished.score"
          values={{ own: mine, opp: theirs, name: oppName }}
          components={{ strong: <strong /> }}
        />
      </p>
      {view.finalScore!.matsch_player !== null && (
        <p className="text-sm text-jass-yellowDark font-semibold">
          {matschMe
            ? t("bodensee.finished.matschYou")
            : t("bodensee.finished.matschOther", { name: oppName })}
        </p>
      )}
    </section>
  );
}
