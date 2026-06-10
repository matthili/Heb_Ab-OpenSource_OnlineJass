/**
 * Visualisiert ein abgespeichertes Spiel Schritt für Schritt.
 *
 * **UI:**
 *   - Scoreboard mit Live-Score nach jedem Move
 *   - Trick-Bereich in der Mitte (re-used `Trick`-Komponente)
 *   - 4 Sitz-Labels (Spieler-Namen, KI-Markierung)
 *   - Move-Liste rechts/unten mit Klick-Navigation
 *   - Vor/Zurück/Play/Pause + Slider
 *
 * **Bewusst nicht in M10-A:**
 *   - Auto-Play-Geschwindigkeit (kommt später, vorerst nur Manual-Step)
 *   - Trick-Winner-Highlight (Trick-Komponente kennt das schon, wir
 *     übergeben den Winner nur, wenn der Trick komplett ist)
 *   - Weisen-Anzeige (kommt mit der Weisen-Implementation)
 */
import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Trick, Scoreboard } from "@jass/ui";
import type { Card } from "@jass/engine";
import { trickWinner } from "@jass/engine";

import { aiName } from "~/features/game/aiNames";
import { relativeSlot, SEAT_LABEL_POS } from "~/features/game/seat-layout";
import type { ReplayBundle } from "./types";
import type { ReplayFrame } from "./useReplay";

interface Props {
  bundle: ReplayBundle;
  frames: readonly ReplayFrame[];
  /** Welcher Sitz ist „mySeat" für die Trick-Orientierung? Default = Sitz 0 (oder eigener Sitz, falls Teilnehmer). */
  mySeat: number;
}

export function ReplayPlayer({ bundle, frames, mySeat }: Props) {
  const { t } = useTranslation();
  const [frameIdx, setFrameIdx] = useState(frames.length - 1); // Start beim Endstand
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(1000); // 1 s/Karte = 4 s pro Stich

  // Auto-Play: solange `isPlaying`, alle `speedMs` einen Frame weiter. Der
  // `setTimeout` re-scheduled sich über die `frameIdx`-Dependency selbst und
  // stoppt am letzten Frame automatisch. Hooks stehen bewusst VOR dem
  // Early-Return unten (Rules of Hooks).
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

  // Play am Ende startet wieder von vorn; sonst toggelt es Play/Pause.
  const togglePlay = () => {
    if (!isPlaying && frameIdx >= frames.length - 1) {
      setFrameIdx(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((p) => !p);
  };

  // Manuelles Springen (Slider, Schritt-Buttons, Zug-Liste) pausiert das
  // Auto-Play — sonst kämpfen Timer und Nutzer um den Frame-Index.
  const seek = (i: number) => {
    setIsPlaying(false);
    setFrameIdx(i);
  };

  const variant = frame.state.variant;
  const trickCards = frame.state.current_trick_cards;
  const trickStarter = frame.state.current_trick_starter;

  let winnerSeat: number | undefined;
  if (trickCards.length === 4) {
    const winnerIdx = trickWinner(trickCards, variant);
    winnerSeat = (trickStarter + winnerIdx) % 4;
  }

  // Punkte aus Team-Sicht: team_card_points ist auf dem (server-)RoundState
  // direkt nach Team-ID indexiert. Mein Team = mySeat % 2 (Kreuz: 0+2 vs 1+3).
  const myTeam = mySeat % 2;
  const ownPts = frame.state.team_card_points[myTeam] ?? 0;
  const oppPts = frame.state.team_card_points[1 - myTeam] ?? 0;

  return (
    <div className="space-y-4">
      <Scoreboard
        ownTeamScore={ownPts}
        oppTeamScore={oppPts}
        trickIdx={frame.state.trick_idx}
        mode={variant.mode}
        {...(variant.trump_suit !== undefined ? { trumpSuit: variant.trump_suit } : {})}
      />

      <PlayingArea
        bundle={bundle}
        trickCards={trickCards}
        trickStarter={trickStarter}
        mySeat={mySeat}
        t={t}
        {...(winnerSeat !== undefined ? { winnerSeat } : {})}
      />

      <ReplayControls
        frameIdx={frameIdx}
        totalFrames={frames.length}
        currentMove={frame.played}
        currentMoveSeq={frame.moveSeq}
        isPlaying={isPlaying}
        speedMs={speedMs}
        onChange={seek}
        onTogglePlay={togglePlay}
        onSpeedChange={setSpeedMs}
        t={t}
      />

      <MoveList
        gameId={bundle.gameId}
        moves={bundle.moves}
        seats={bundle.seats}
        currentSeq={frame.moveSeq}
        onJump={(seq) => seek(seq)}
        t={t}
      />
    </div>
  );
}

function PlayingArea({
  bundle,
  trickCards,
  trickStarter,
  mySeat,
  winnerSeat,
  t,
}: {
  bundle: ReplayBundle;
  trickCards: readonly Card[];
  trickStarter: number;
  mySeat: number;
  winnerSeat?: number;
  t: TFunction;
}) {
  return (
    <div
      // Gleiches Grid wie das laufende Spiel (`GameBoard`): die mittlere Zeile
      // (`1fr`) trägt den Trick, die Sitz-Labels sitzen in den auto-Rändern.
      className="grid grid-cols-3 grid-rows-[auto_1fr_auto] gap-2 min-h-[28rem] bg-emerald-50 border border-emerald-200 rounded-lg p-4 relative"
      role="region"
      aria-label={t("replay.player.areaAria")}
    >
      {bundle.seats.map((s) => {
        if (s.seat === mySeat) return null;
        const slot = relativeSlot(s.seat, mySeat);
        const label =
          s.displayName ??
          (s.aiSeatType
            ? aiName(`${bundle.gameId}:${s.seat}`, s.aiSeatType)
            : t("replay.player.seatFallback", { n: s.seat }));
        return (
          <div
            key={s.seat}
            className={`${SEAT_LABEL_POS[slot]} text-sm rounded bg-white text-stone-700 px-2 py-1 z-10 shadow-sm whitespace-nowrap`}
          >
            {label}
          </div>
        );
      })}
      {/* Eigener Sitz-Label am unteren Rand */}
      <div
        className={`${SEAT_LABEL_POS.bottom} text-sm rounded bg-stone-900 text-white px-2 py-1 z-10 shadow-sm whitespace-nowrap`}
      >
        {t("replay.player.youSuffix", {
          name:
            bundle.seats.find((s) => s.seat === mySeat)?.displayName ??
            t("replay.player.seatFallback", { n: mySeat }),
        })}
      </div>

      <div className="row-start-1 row-end-4 col-start-1 col-end-4 pointer-events-none relative z-10">
        <Trick
          cards={trickCards}
          starter={trickStarter}
          mySeat={mySeat}
          {...(winnerSeat !== undefined ? { winnerSeat } : {})}
        />
      </div>
    </div>
  );
}

function ReplayControls({
  frameIdx,
  totalFrames,
  currentMove,
  currentMoveSeq,
  isPlaying,
  speedMs,
  onChange,
  onTogglePlay,
  onSpeedChange,
  t,
}: {
  frameIdx: number;
  totalFrames: number;
  currentMove: { seat: number; card: Card } | null;
  currentMoveSeq: number | null;
  isPlaying: boolean;
  speedMs: number;
  onChange: (i: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (ms: number) => void;
  t: TFunction;
}) {
  const atEnd = frameIdx === totalFrames - 1;
  return (
    <div className="rounded border border-stone-200 bg-white p-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(0)}
          disabled={frameIdx === 0}
          className="rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-40"
          aria-label={t("replay.player.toStart")}
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.max(0, frameIdx - 1))}
          disabled={frameIdx === 0}
          className="rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-40"
          aria-label={t("replay.player.stepBack")}
        >
          ◀
        </button>
        {/* Play/Pause — die primäre Steuerung, daher farblich abgesetzt und
            mit ⏸/⏵ klar von den ◀▶-Schritt-Buttons unterscheidbar. */}
        <button
          type="button"
          onClick={onTogglePlay}
          className="rounded bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700"
          aria-label={isPlaying ? t("replay.player.pause") : t("replay.player.play")}
          aria-pressed={isPlaying}
        >
          {isPlaying ? "⏸" : atEnd ? "↻" : "⏵"}
        </button>
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          step={1}
          value={frameIdx}
          onChange={(e) => onChange(parseInt(e.currentTarget.value, 10))}
          className="flex-1"
          aria-label={t("replay.player.framePosition")}
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(totalFrames - 1, frameIdx + 1))}
          disabled={atEnd}
          className="rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-40"
          aria-label={t("replay.player.stepForward")}
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => onChange(totalFrames - 1)}
          disabled={atEnd}
          className="rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-40"
          aria-label={t("replay.player.toEnd")}
        >
          ⏭
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-stone-600">
          {currentMoveSeq === null ? (
            <span>{t("replay.player.initialState")}</span>
          ) : (
            <span>
              {t("replay.player.moveProgress", { seq: currentMoveSeq, total: totalFrames - 1 })}
              {currentMove
                ? t("replay.player.movePlays", {
                    seat: currentMove.seat,
                    suit: t(`game.announce.suit.${currentMove.card.suit}`),
                    rank: t(`replay.rank.${currentMove.card.rank}`),
                  })
                : ""}
            </span>
          )}
        </div>
        <select
          value={speedMs}
          onChange={(e) => onSpeedChange(parseInt(e.currentTarget.value, 10))}
          className="rounded border border-stone-300 px-1.5 py-1 text-xs text-stone-700"
          aria-label={t("replay.player.speed")}
        >
          <option value={2000}>{t("replay.player.speedSlow")}</option>
          <option value={1000}>{t("replay.player.speedNormal")}</option>
          <option value={500}>{t("replay.player.speedFast")}</option>
        </select>
      </div>
    </div>
  );
}

function MoveList({
  gameId,
  moves,
  seats,
  currentSeq,
  onJump,
  t,
}: {
  gameId: string;
  moves: ReplayBundle["moves"];
  seats: ReplayBundle["seats"];
  currentSeq: number | null;
  onJump: (frameIdx: number) => void;
  t: TFunction;
}) {
  const nameOf = (seat: number): string => {
    const s = seats.find((x) => x.seat === seat);
    return (
      s?.displayName ??
      (s?.aiSeatType
        ? aiName(`${gameId}:${seat}`, s.aiSeatType)
        : t("replay.player.seatFallback", { n: seat }))
    );
  };
  return (
    <details className="rounded border border-stone-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {t("replay.player.moveListSummary", { count: moves.length })}
      </summary>
      <ol className="divide-y divide-stone-100 max-h-80 overflow-auto">
        {moves.map((m) => {
          const isCurrent = m.seq === currentSeq;
          return (
            <li key={m.seq}>
              <button
                type="button"
                onClick={() => onJump(m.seq)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 ${
                  isCurrent ? "bg-amber-50 font-medium" : ""
                }`}
              >
                {t("replay.player.moveListItem", {
                  seq: m.seq,
                  trick: m.trickIdx + 1,
                  name: nameOf(m.seat),
                  cardIndex: m.cardIndex,
                })}
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
