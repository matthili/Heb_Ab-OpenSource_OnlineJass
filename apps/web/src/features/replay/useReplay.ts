/**
 * Replay-Hook: lädt das Bundle via REST, rekonstruiert pro Sitz die
 * initiale Hand aus den Move-Karten, baut den `RoundState` via
 * `newRound`, und stellt eine `frames[]`-Sequenz bereit (frame 0 =
 * vor dem ersten Move, frame N = nach dem N-ten Move).
 *
 * Performance: Frames werden lazy aufgebaut, sobald das Bundle da ist.
 * Bei 4 × 9 = 36 Moves ist die Anzahl klein — keine Memoization-Tricks
 * nötig.
 *
 * **Was kann hier schiefgehen?**
 *   - Game ist noch nicht abgeschlossen → moves.length < 36, Frame-Liste
 *     ist kürzer; die Replay-UI rendert das, was da ist.
 *   - Inkonsistenz zwischen RoundDecision und Moves → `applyMove` wirft
 *     `InvalidMoveError`. Wir fangen das ab und liefern einen Fehler-
 *     State zurück; die UI rendert "Replay nicht rekonstruierbar".
 */
import { useQuery } from "@tanstack/react-query";

import { api } from "~/lib/api";
import type { Announcement, Card, Variant, RoundState } from "@jass/engine";
import { applyMove, indexToCard, newRound } from "@jass/engine";

import type { ReplayBundle } from "./types";
import { SUIT_BY_ID } from "./types";

export interface ReplayFrame {
  /** RoundState NACH dem `seq`-ten Move. Frame 0 = Initialstand. */
  state: RoundState;
  /** Welcher Move hat diesen Frame erzeugt? Frame 0 → null. */
  moveSeq: number | null;
  /** Der gespielte Move für diesen Frame (für UI-Highlight). Frame 0 → null. */
  played: { seat: number; card: Card } | null;
}

export interface ReplayData {
  bundle: ReplayBundle;
  frames: ReplayFrame[];
  /** Falls die Rekonstruktion fehlschlägt: Fehlertext. */
  error: string | null;
}

export function useReplay(gameId: string | undefined) {
  return useQuery<ReplayData>({
    queryKey: ["games", gameId, "replay"],
    enabled: Boolean(gameId),
    queryFn: async () => {
      const bundle = await api<ReplayBundle>(`/api/games/${gameId!}/replay`);
      return reconstruct(bundle);
    },
    // Replays sind unveränderlich — kein Refetch nötig.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

/**
 * Liest die Hand pro Sitz aus dem Bundle, indem alle Moves dieses Sitzes
 * eingesammelt werden. Reihenfolge in der Hand spielt für die Engine
 * keine Rolle.
 */
export function reconstruct(bundle: ReplayBundle): ReplayData {
  const round0 = bundle.rounds[0];
  if (!round0) {
    return { bundle, frames: [], error: "Replay: keine Runde gefunden." };
  }

  // 4 × 9 Karten aus den Move-Cards rekonstruieren.
  const hands: Card[][] = [[], [], [], []];
  for (const m of bundle.moves) {
    const card = indexToCard(m.cardIndex);
    const handArr = hands[m.seat];
    if (!handArr) {
      return { bundle, frames: [], error: `Replay: ungültiger Sitz ${m.seat}.` };
    }
    handArr.push(card);
  }
  // Bei laufendem Spiel (<36 Moves) haben einzelne Sitze evtl. noch Karten
  // in der Hand; M10-A unterstützt nur fertige Spiele richtig — wir geben
  // einen Hinweis und bauen das Replay so weit wie möglich auf.
  const isPartial = bundle.moves.length < 36;

  // Variant + Announcement aus der RoundDecision.
  const trumpSuit = round0.trumpSuit !== null ? SUIT_BY_ID[round0.trumpSuit] : undefined;
  const variant: Variant =
    trumpSuit !== undefined
      ? { mode: round0.mode as Variant["mode"], trump_suit: trumpSuit }
      : { mode: round0.mode as Variant["mode"] };
  const announcement: Announcement = { variant, slalom: false };

  // Bei einem unvollständigen Spiel kennen wir die Initial-Hände nicht
  // vollständig (manche Spieler haben noch Karten). Wir können das Replay
  // dann nur ab den Moves abspielen, die wir kennen — also bauen wir
  // initial einen State, der den Moves entspricht, aber das ist nicht
  // ganz korrekt (newRound erwartet 9 Karten pro Sitz). Workaround:
  // wir zeigen das Banner und brechen die Frame-Erzeugung früh ab.
  if (isPartial) {
    return {
      bundle,
      frames: [],
      error: `Replay: Spiel ist noch nicht abgeschlossen (${bundle.moves.length}/36 Moves).`,
    };
  }

  let state: RoundState;
  try {
    state = newRound({
      variant,
      announcement,
      hands,
      starter: round0.starter,
    });
  } catch (err) {
    return {
      bundle,
      frames: [],
      error: `Replay: Initial-State konnte nicht rekonstruiert werden — ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const frames: ReplayFrame[] = [{ state, moveSeq: null, played: null }];

  for (const m of bundle.moves) {
    const card = indexToCard(m.cardIndex);
    try {
      state = applyMove(state, { seat: m.seat, card });
    } catch (err) {
      return {
        bundle,
        frames,
        error:
          `Replay: Move ${m.seq} (Sitz ${m.seat}, Karte ${card.suit}-${card.rank}) ` +
          `fehlgeschlagen — ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    frames.push({ state, moveSeq: m.seq, played: { seat: m.seat, card } });
  }

  return { bundle, frames, error: null };
}

/**
 * Berechnet aus einem Frame die hilfreichen UI-Daten für das aktuelle
 * Sitz-Highlight (wer hat zuletzt gespielt, wer ist als Nächstes dran).
 */
export function frameMeta(frame: ReplayFrame): {
  trickIdx: number;
  trickCards: readonly Card[];
  starter: number;
} {
  return {
    trickIdx: frame.state.trick_idx,
    trickCards: frame.state.current_trick_cards,
    starter: frame.state.current_trick_starter,
  };
}
