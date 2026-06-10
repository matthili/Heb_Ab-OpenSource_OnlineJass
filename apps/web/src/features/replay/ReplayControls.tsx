/**
 * Geteilte Replay-Transportsteuerung — von `ReplayPlayer` (Kreuz/Solo) und
 * `BodenseeReplayPlayer` (Bodensee) verwendet.
 *
 * Enthält: An-den-Anfang / Schritt-zurück / **Play-Pause** / Slider /
 * Schritt-vor / An-das-Ende, dazu eine Tempo-Auswahl (2 s / 1 s / 0,5 s pro
 * Karte). Der variantenspezifische Status-Text (z.B. „Zug 5/36 — Spieler X
 * spielt …") kommt von außen via `statusText`, weil er sich zwischen den
 * Varianten unterscheidet.
 */
import type { TFunction } from "i18next";

export interface ReplayControlsProps {
  frameIdx: number;
  totalFrames: number;
  isPlaying: boolean;
  speedMs: number;
  onChange: (i: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (ms: number) => void;
  /** Status-Zeile links unten (variantenspezifisch zusammengebaut). */
  statusText: string;
  t: TFunction;
}

export function ReplayControls({
  frameIdx,
  totalFrames,
  isPlaying,
  speedMs,
  onChange,
  onTogglePlay,
  onSpeedChange,
  statusText,
  t,
}: ReplayControlsProps) {
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
            mit ⏸/⏵ klar von den ◀▶-Schritt-Buttons unterscheidbar. Am Ende
            zeigt es ↻ (von vorn). */}
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
        <div className="text-xs text-stone-600">{statusText}</div>
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
