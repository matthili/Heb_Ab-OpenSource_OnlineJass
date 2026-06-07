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
import { cardIndex, type Card as CardModel, type PlayMode, type Suit } from "@jass/engine";
import { Card } from "@jass/ui";
import type { TFunction } from "i18next";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { seatDisplayName } from "~/features/game/aiNames";
import type { SeatView } from "~/features/lobby/types";
import type { BodenseeAnnouncement, BodenseeView } from "./types";

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

  return (
    <div className="space-y-3">
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
            mode: view.playMode ? modeLabel(t, view.playMode) : "—",
          })}
          {view.trumpSuit ? ` ${suitLabel(t, view.trumpSuit)}` : ""}
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

      {/* Stich-Mitte */}
      <section className="rounded-xl bg-emerald-800 px-4 py-5 text-center text-emerald-50 shadow-inner">
        <TrickArea view={view} seatName={seatName} />
      </section>

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
          <AnnouncePanel pending={announcePending} onAnnounce={onAnnounce} />
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

function TrickArea({ view, seatName }: { view: BodenseeView; seatName: (seat: number) => string }) {
  const { t } = useTranslation();
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

  const last = view.lastTrick;
  if (last) {
    return (
      <div>
        <p className="text-xs uppercase tracking-wide text-emerald-200 mb-2">
          {last.winner === view.mySeat
            ? t("bodensee.trick.lastWonByYou")
            : t("bodensee.trick.lastWonByOther", { name: seatName(last.winner) })}
        </p>
        <div className="flex items-end justify-center gap-4 opacity-80">
          {last.cards.map((c, i) => {
            const seat = i === 0 ? last.starter : 1 - last.starter;
            return (
              <div key={`lt-${i}`} className="space-y-1">
                <Card card={c} size="sm" />
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

  return <p className="text-sm text-emerald-100">{t("bodensee.trick.starting")}</p>;
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

const ANNOUNCE_MODES: readonly AnnounceMode[] = ["TRUMPF", "GUMPF", "OBEN", "UNTEN", "SLALOM"];

const SUITS: readonly Suit[] = ["EICHEL", "SCHELLE", "HERZ", "LAUB"];

function AnnouncePanel({
  pending,
  onAnnounce,
}: {
  pending: boolean;
  onAnnounce: (a: BodenseeAnnouncement) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AnnounceMode>("TRUMPF");
  const [suit, setSuit] = useState<Suit>("EICHEL");
  const needsSuit = mode === "TRUMPF" || mode === "GUMPF";

  function confirm() {
    if (mode === "SLALOM") {
      onAnnounce({ variant: { mode: "OBEN" }, slalom: true });
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
        {ANNOUNCE_MODES.map((m) => (
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
