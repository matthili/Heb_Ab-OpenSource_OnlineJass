/**
 * Bodensee-Replay-Board — spielt eine abgespeicherte 2-Spieler-Partie Schritt
 * für Schritt ab. Anders als das Live-Board zeigt das Replay **beide** Hände
 * und Tische offen (es gibt nichts mehr zu verbergen) — der Reiz ist ja gerade,
 * im Nachhinein zu sehen, was der Gegner auf der Hand hatte.
 *
 * Aufbau (oben → unten):
 *   - Status-Leiste: Stich-Zähler, Modus/Trumpf, Punkte beider Spieler
 *   - Gegner-Bereich: Hand (offen) + Tisch-Stapel
 *   - Stich-Mitte: laufender Stich bzw. zuletzt abgeschlossener (+ Gewinner)
 *   - Eigener Bereich: Tisch-Stapel + Hand (offen)
 *   - Transportsteuerung (geteilt mit Kreuz/Solo) + Zug-Liste + Endstand
 *
 * Die Frames kommen fertig rekonstruiert aus `reconstructBodensee` — hier wird
 * nur noch der `BodenseeRoundState` des aktuellen Frames gerendert.
 */
import {
  cardIndex,
  indexToCard,
  type Card as CardModel,
  type PlayMode,
  type Suit,
} from "@jass/engine";
import { Card, useAnimatedNumber, useScorePop } from "@jass/ui";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { aiName } from "~/features/game/aiNames";
import { ReplayControls } from "./ReplayControls";
import type { ReplayBundle } from "./types";
import type { BodenseeReplayFrame } from "./useReplay";

interface Props {
  bundle: ReplayBundle;
  frames: readonly BodenseeReplayFrame[];
  /** Aus wessen Sicht (unten) wird gezeigt? 0 oder 1. */
  mySeat: number;
}

export function BodenseeReplayPlayer({ bundle, frames, mySeat }: Props) {
  const { t } = useTranslation();
  const [frameIdx, setFrameIdx] = useState(frames.length - 1); // Start beim Endstand
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(1000); // 1 s/Karte = 4 s pro Stich

  // Auto-Play (identisch zu Kreuz/Solo): setTimeout re-scheduled sich pro Frame
  // und stoppt am Ende. Hooks vor dem Early-Return (Rules of Hooks).
  useEffect(() => {
    if (!isPlaying) return;
    if (frameIdx >= frames.length - 1) {
      setIsPlaying(false);
      return;
    }
    const id = setTimeout(() => setFrameIdx((i) => Math.min(frames.length - 1, i + 1)), speedMs);
    return () => clearTimeout(id);
  }, [isPlaying, frameIdx, speedMs, frames.length]);

  const frame = frames[frameIdx];
  if (!frame) {
    return <div className="text-sm text-stone-600">{t("replay.noPlayerFrames")}</div>;
  }

  const togglePlay = () => {
    if (!isPlaying && frameIdx >= frames.length - 1) {
      setFrameIdx(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((p) => !p);
  };
  const seek = (i: number) => {
    setIsPlaying(false);
    setFrameIdx(i);
  };

  const state = frame.state;
  const oppSeat = 1 - mySeat;
  const seatName = (seat: number): string => {
    const s = bundle.seats.find((x) => x.seat === seat);
    return (
      s?.displayName ??
      (s?.aiSeatType
        ? aiName(`${bundle.gameId}:${seat}`, s.aiSeatType)
        : t("replay.player.seatFallback", { n: seat }))
    );
  };

  const mode = state.variant.mode;
  const trumpSuit = state.variant.trump_suit;
  const slalom = state.announcement.slalom;

  const statusText =
    frame.moveSeq === null
      ? t("replay.player.initialState")
      : t("replay.player.moveProgress", { seq: frame.moveSeq, total: frames.length - 1 }) +
        (frame.played
          ? " — " +
            t("replay.bodensee.playsLine", {
              name: seatName(frame.played.player),
              suit: t(`game.announce.suit.${frame.played.card.suit}`),
              rank: t(`replay.rank.${frame.played.card.rank}`),
            })
          : "");

  return (
    <div className="space-y-3">
      {/* Status-Leiste */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm">
        <span className="text-stone-600">
          {t("replay.bodensee.trick", { n: Math.min(state.trick_idx + 1, 18) })}
        </span>
        <span className="rounded bg-amber-100 px-2.5 py-1 text-sm font-bold text-amber-900 ring-1 ring-amber-300">
          {slalom ? t("game.announce.mode.SLALOM") : modeLabel(t, mode)}
          {!slalom && trumpSuit ? ` ${suitLabel(t, trumpSuit)}` : ""}
        </span>
        <span className="flex items-center gap-1.5 text-stone-700">
          <span>{seatName(mySeat)}</span>
          <ScoreValue value={state.player_card_points[mySeat] ?? 0} />
          <span className="text-stone-400">:</span>
          <ScoreValue value={state.player_card_points[oppSeat] ?? 0} />
          <span>{seatName(oppSeat)}</span>
        </span>
      </div>

      {/* Gegner-Bereich (oben) */}
      <PlayerArea
        name={seatName(oppSeat)}
        hand={state.hands[oppSeat] ?? []}
        table={state.tables[oppSeat] ?? []}
        t={t}
      />

      {/* Stich-Mitte */}
      <section className="min-h-[9rem] rounded-xl bg-emerald-800 px-4 py-5 text-center text-emerald-50 shadow-inner">
        <TrickArea state={state} mySeat={mySeat} seatName={seatName} t={t} />
      </section>

      {/* Eigener Bereich (unten) */}
      <PlayerArea
        name={t("replay.player.youSuffix", { name: seatName(mySeat) })}
        hand={state.hands[mySeat] ?? []}
        table={state.tables[mySeat] ?? []}
        highlight
        t={t}
      />

      <ReplayControls
        frameIdx={frameIdx}
        totalFrames={frames.length}
        isPlaying={isPlaying}
        speedMs={speedMs}
        onChange={seek}
        onTogglePlay={togglePlay}
        onSpeedChange={setSpeedMs}
        statusText={statusText}
        t={t}
      />

      <BodenseeMoveList
        bundle={bundle}
        currentSeq={frame.moveSeq}
        onJump={seek}
        seatName={seatName}
        t={t}
      />

      {bundle.finalScore && (
        <BodenseeFinalScore
          finalScore={bundle.finalScore}
          mySeat={mySeat}
          seatName={seatName}
          t={t}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Spieler-Bereich (Hand + Tisch-Stapel)
// ─────────────────────────────────────────────────────────────────────

function PlayerArea({
  name,
  hand,
  table,
  highlight,
  t,
}: {
  name: string;
  hand: readonly CardModel[];
  table: readonly { visible: CardModel | null; hidden: CardModel | null }[];
  highlight?: boolean;
  t: TFunction;
}) {
  return (
    <section
      className={`rounded-lg border p-3 space-y-2 ${
        highlight ? "border-emerald-300 bg-emerald-50/60" : "border-stone-200 bg-white"
      }`}
    >
      <div className="text-sm font-semibold text-stone-800">{name}</div>
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">
          {t("replay.bodensee.tableLabel")}
        </p>
        <div className="flex flex-wrap items-end gap-1.5">
          {table.map((stack, i) => (
            <TableStackSlot key={`stack-${i}`} stack={stack} t={t} />
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">
          {t("replay.bodensee.handLabel")}
        </p>
        <div className="flex flex-wrap items-end gap-1.5">
          {hand.length === 0 && (
            <span className="text-sm italic text-stone-400">{t("bodensee.noHandCards")}</span>
          )}
          {[...hand]
            .sort((a, b) => cardIndex(a) - cardIndex(b))
            .map((c) => (
              <Card key={`${c.suit}-${c.rank}`} card={c} size="sm" />
            ))}
        </div>
      </div>
    </section>
  );
}

function TableStackSlot({
  stack,
  t,
}: {
  stack: { visible: CardModel | null; hidden: CardModel | null };
  t: TFunction;
}) {
  if (!stack.visible) {
    return (
      <div className="h-24 w-16 rounded-md border border-dashed border-stone-300 bg-stone-50" />
    );
  }
  return (
    <div className="relative">
      <Card card={stack.visible} size="sm" />
      {stack.hidden && (
        <span
          className="absolute -bottom-1 -right-1 rounded-full bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 ring-1 ring-amber-500"
          title={t("bodensee.hiddenBelow")}
        >
          +1
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stich-Mitte
// ─────────────────────────────────────────────────────────────────────

function TrickArea({
  state,
  mySeat,
  seatName,
  t,
}: {
  state: BodenseeReplayFrame["state"];
  mySeat: number;
  seatName: (seat: number) => string;
  t: TFunction;
}) {
  // Laufender Stich (genau 1 Karte — die Engine leert den Stich beim 2.).
  if (state.current_trick_cards.length > 0) {
    const starter = state.current_trick_starter;
    return (
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-emerald-200">
          {t("bodensee.trick.running")}
        </p>
        <TrickCards
          cards={state.current_trick_cards}
          starter={starter}
          mySeat={mySeat}
          seatName={seatName}
          t={t}
        />
      </div>
    );
  }

  // Zuletzt abgeschlossener Stich + Gewinner.
  const lastIdx = state.completed_tricks.length - 1;
  if (lastIdx >= 0) {
    const tr = state.completed_tricks[lastIdx]!;
    const winner = state.trick_winners[lastIdx]!;
    return (
      <div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-100">
          {winner === mySeat
            ? t("bodensee.trick.lastWonByYou")
            : t("bodensee.trick.lastWonByOther", { name: seatName(winner) })}
        </p>
        <TrickCards
          cards={tr.cards}
          starter={tr.starter}
          mySeat={mySeat}
          seatName={seatName}
          winner={winner}
          t={t}
        />
      </div>
    );
  }

  return <p className="text-sm text-emerald-100">{t("bodensee.trick.starting")}</p>;
}

function TrickCards({
  cards,
  starter,
  mySeat,
  seatName,
  winner,
  t,
}: {
  cards: readonly CardModel[];
  starter: number;
  mySeat: number;
  seatName: (seat: number) => string;
  winner?: number;
  t: TFunction;
}) {
  return (
    <div className="flex items-end justify-center gap-4">
      {cards.map((c, i) => {
        const seat = i === 0 ? starter : 1 - starter;
        const isWinner = winner !== undefined && seat === winner;
        return (
          <div key={`tc-${i}`} className="space-y-1">
            <div className={isWinner ? "rounded-lg ring-2 ring-amber-400 ring-offset-1" : ""}>
              <Card card={c} size="md" />
            </div>
            <p className="text-xs text-emerald-100">
              {seat === mySeat ? t("game.you") : seatName(seat)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Zug-Liste
// ─────────────────────────────────────────────────────────────────────

function BodenseeMoveList({
  bundle,
  currentSeq,
  onJump,
  seatName,
  t,
}: {
  bundle: ReplayBundle;
  currentSeq: number | null;
  onJump: (frameIdx: number) => void;
  seatName: (seat: number) => string;
  t: TFunction;
}) {
  return (
    <details className="rounded border border-stone-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {t("replay.player.moveListSummary", { count: bundle.moves.length })}
      </summary>
      <ol className="max-h-80 divide-y divide-stone-100 overflow-auto">
        {bundle.moves.map((m) => {
          const card = indexToCard(m.cardIndex);
          const isCurrent = m.seq === currentSeq;
          return (
            <li key={m.seq}>
              <button
                type="button"
                onClick={() => onJump(m.seq)}
                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-stone-50 ${
                  isCurrent ? "bg-amber-50 font-medium" : ""
                }`}
              >
                {t("replay.bodensee.moveListItem", {
                  seq: m.seq,
                  trick: m.trickIdx + 1,
                  name: seatName(m.seat),
                  suit: t(`game.announce.suit.${card.suit}`),
                  rank: t(`replay.rank.${card.rank}`),
                })}
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Endstand
// ─────────────────────────────────────────────────────────────────────

function BodenseeFinalScore({
  finalScore,
  mySeat,
  seatName,
  t,
}: {
  finalScore: NonNullable<ReplayBundle["finalScore"]>;
  mySeat: number;
  seatName: (seat: number) => string;
  t: TFunction;
}) {
  const oppSeat = 1 - mySeat;
  const points = finalScore.team_card_points; // bei Bodensee spieler-indexiert
  const rows: { seat: number }[] = [{ seat: mySeat }, { seat: oppSeat }];
  return (
    <div className="rounded border border-stone-200 bg-white p-4">
      <h2 className="mb-2 text-lg font-semibold">{t("replay.finalScore.title")}</h2>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(({ seat }) => (
            <tr key={seat} className={seat === mySeat ? "font-medium" : ""}>
              <td className="py-1 pr-2">{seatName(seat)}</td>
              <td className="py-1 text-right tabular-nums">{points[seat] ?? 0}</td>
              <td className="py-1 pl-2 text-amber-700">
                {finalScore.matsch_team === seat ? t("replay.bodensee.matsch") : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function modeLabel(t: TFunction, mode: PlayMode): string {
  return t(`game.announce.mode.${mode}`);
}
function suitLabel(t: TFunction, suit: Suit): string {
  return t(`game.announce.suit.${suit}`);
}

/**
 * Eine Punktzahl mit weichem Hochzählen + „+X"-Pop bei Anstieg — dieselben
 * Hooks wie das Kreuz-Scoreboard, damit der Bodensee-Replay denselben feinen
 * Effekt zeigt. Beim Zurückspulen sinkt der Wert → kein Pop (useScorePop
 * reagiert nur auf Anstieg).
 */
function ScoreValue({ value }: { value: number }) {
  const animated = useAnimatedNumber(value);
  const pop = useScorePop(value);
  return (
    <span className="relative inline-block">
      <strong className="tabular-nums text-stone-900">{animated}</strong>
      {pop && (
        <span
          key={pop.seq}
          className="jass-score-pop absolute -top-1 left-1/2 -translate-x-1/2 font-semibold text-base text-jass-green"
        >
          +{pop.delta}
        </span>
      )}
    </span>
  );
}
