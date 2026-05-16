/**
 * Server-autoritativer Game-Service.
 *
 * Verantwortlichkeiten:
 *   - **Spielanlage**: Karten verteilen (kryptographische RNG), `Game`-Row +
 *     `GameSeat`-Rows + `RoundDecision` in Postgres anlegen, initialen
 *     `RoundState` in Redis cachen.
 *   - **Move-Validierung & -Anwendung**: Server ist die einzige Autorität.
 *     Clients schicken `(gameId, card)`, der Service prüft Reihenfolge +
 *     Legalität via `engine.applyMove`. InvalidMoves führen zu `BadRequest`,
 *     der State wird NICHT verändert.
 *   - **Move-Persistenz**: jeder akzeptierte Move wird sofort als `Move`-Row
 *     in Postgres geloggt (für Replays + Forensik) und der neue `RoundState`
 *     in Redis aktualisiert.
 *   - **Sicht-Filterung**: für jeden Client liefert
 *     `viewForPlayer(gameId, userId)` nur den per-Sitz gefilterten `GameState`
 *     + die eigene Hand. Fremde Hände verlassen den Server niemals.
 *
 * Aktuelle Einschränkungen (M4):
 *   - Genau eine Runde pro Game (`round_idx = 0`). Multi-Runden-Logik kommt mit M6.
 *   - Variante wird beim Anlegen fixiert (kein Trumpf-Ansage-Dialog, kein Push).
 *   - Single-Owner-pro-Tisch (Redis-Lock) noch nicht aktiv — kommt mit M11
 *     für Multi-Instance.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { GameVariant, Prisma } from "@prisma/client";

import {
  type Announcement,
  type Card,
  type GameState,
  type Move,
  type RandomFn,
  type RoundState,
  type Variant,
  applyMove,
  cardIndex,
  dealCards,
  finalRoundScore,
  handOf,
  InvalidMoveError,
  isRoundDone,
  legalActionMask,
  newRound,
  SPEC_VERSION,
  viewAsPlayer,
  whoseTurn,
} from "@jass/engine";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { RandomLegalMovePlayer, type AIPlayer } from "./players/random-player.js";

const REDIS_STATE_TTL_SECONDS = 6 * 60 * 60; // 6h ohne Move → State läuft ab

function redisStateKey(gameId: string): string {
  return `game:${gameId}:state`;
}

/**
 * Eingabe für `createGame`. Sitze sind 4 Einträge in Sitz-Reihenfolge 0..3.
 * `userId === null` markiert einen KI-Sitz (M4-D füllt diese automatisch).
 */
export interface SeatAssignment {
  /** 0..3, absolute Sitz-Position. */
  seat: number;
  userId: string | null;
  /** "random" für RandomLegalMovePlayer, "nn-vX.Y.Z" für NN-basierte KI (M5). */
  aiSeatType: string | null;
}

export interface CreateGameInput {
  variant: Variant;
  /** Startansage (Slalom-Flag etc.). Für M4 = `{ variant, slalom: false }`. */
  announcement: Announcement;
  /** Welcher Sitz beginnt? Bei Kreuz-Jass üblicherweise der Ansager. */
  starter: number;
  /** 4 Einträge, je einer pro Sitz. */
  seats: readonly SeatAssignment[];
  /** Optionaler Seed für deterministisches Mischen (Tests). */
  rngSeed?: number;
}

/**
 * Was eine Client-Sicht enthält:
 *  - der per-Sitz gefilterte GameState (Encoder-Input + UI-Daten)
 *  - die eigene Hand (Karten als Array)
 *  - die Aktions-Maske: welche Karten darf ich spielen?
 *  - "ist gerade jemand dran?" + "bin ich es?"
 *  - Game-Status (running/finished)
 */
export interface PlayerView {
  gameId: string;
  status: "playing" | "finished";
  state: GameState;
  hand: readonly Card[];
  legalActionMask: readonly number[]; // 36 Bytes
  whoseTurnSeat: number;
  myTurn: boolean;
  finalScore?: {
    team_card_points: readonly number[];
    matsch_team: number | null;
    trick_winners: readonly number[];
  };
}

@Injectable()
export class GameService {
  private readonly log = new Logger(GameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService
  ) {}

  // ───────────────────────────────────────────────────────────────────
  // createGame
  // ───────────────────────────────────────────────────────────────────

  async createGame(input: CreateGameInput): Promise<{ gameId: string }> {
    if (input.seats.length !== 4) {
      throw new BadRequestException("Need exactly 4 seats for KREUZ_4P");
    }
    // Doppelte UserIds verbieten (gleicher User darf nicht zwei Sitze haben).
    const userIds = input.seats.map((s) => s.userId).filter((u): u is string => u !== null);
    if (new Set(userIds).size !== userIds.length) {
      throw new BadRequestException("Same user cannot occupy multiple seats");
    }

    const rng: RandomFn = input.rngSeed !== undefined ? seededRng(input.rngSeed) : cryptoRng();
    const hands = dealCards(rng);

    const state = newRound({
      variant: input.variant,
      announcement: input.announcement,
      hands,
      starter: input.starter,
    });

    // Game + GameSeats + RoundDecision in einer Transaktion anlegen. `seats`
    // ist eine Relation auf GameSeat-Rows, keine Json-Spalte am Game-Model.
    const game = await this.prisma.$transaction(async (tx) => {
      const created = await tx.game.create({
        data: {
          variant: variantToEnum(input.variant),
          ruleVersion: SPEC_VERSION,
        },
      });
      for (const s of input.seats) {
        await tx.gameSeat.create({
          data: {
            gameId: created.id,
            seat: s.seat,
            userId: s.userId,
            aiSeatType: s.aiSeatType,
          },
        });
      }
      await tx.roundDecision.create({
        data: {
          gameId: created.id,
          roundIdx: 0,
          mode: input.variant.mode,
          trumpSuit:
            input.variant.trump_suit !== undefined ? suitToInt(input.variant.trump_suit) : null,
          starter: input.starter,
          weisen: {},
        },
      });
      return created;
    });

    await this.writeRoundStateToRedis(game.id, state);

    await this.audit.record({
      action: "game.created",
      target: game.id,
      meta: asJson({
        variant: input.variant.mode,
        trumpSuit: input.variant.trump_suit ?? null,
        starter: input.starter,
        seats: input.seats,
      }),
    });
    this.log.log({ gameId: game.id, variant: input.variant.mode }, "Game created");
    return { gameId: game.id };
  }

  // ───────────────────────────────────────────────────────────────────
  // Sicht für einen Client
  // ───────────────────────────────────────────────────────────────────

  /**
   * Liefert die per-Sitz gefilterte Sicht für einen User.
   * Wirft `NotFoundException`, wenn der User keinen Sitz an diesem Tisch hat.
   */
  async viewForUser(gameId: string, userId: string): Promise<PlayerView> {
    const seat = await this.findSeatForUser(gameId, userId);
    return this.viewForSeat(gameId, seat);
  }

  /**
   * Sicht für einen bestimmten Sitz (für KI-Auto-Step + interne Diagnose).
   */
  async viewForSeat(gameId: string, seat: number): Promise<PlayerView> {
    const state = await this.loadRoundState(gameId);
    const gs = viewAsPlayer(state, seat);
    const hand = handOf(state, seat);
    const mask = legalActionMask(hand, gs);
    const finished = isRoundDone(state);
    const view: PlayerView = {
      gameId,
      status: finished ? "finished" : "playing",
      state: gs,
      hand,
      legalActionMask: Array.from(mask),
      whoseTurnSeat: finished ? -1 : whoseTurn(state),
      myTurn: !finished && whoseTurn(state) === seat,
    };
    if (finished) {
      view.finalScore = finalRoundScore(state);
    }
    return view;
  }

  // ───────────────────────────────────────────────────────────────────
  // Move anwenden
  // ───────────────────────────────────────────────────────────────────

  /**
   * Move eines authentifizierten Users — der Sitz wird aus der DB aufgelöst.
   * Auf Erfolg: neuer RoundState in Redis, Move-Row in PG, evtl. Game-Ende.
   */
  async playMoveAsUser(gameId: string, userId: string, card: Card): Promise<{ view: PlayerView }> {
    const seat = await this.findSeatForUser(gameId, userId);
    return this.playMoveAsSeat(gameId, seat, card, userId);
  }

  /**
   * Move eines bestimmten Sitzes — auch ohne User (KI-Sitze).
   * Schreibt `userId: null` in den Move-Eintrag, wenn keiner mitgegeben wird.
   */
  async playMoveAsSeat(
    gameId: string,
    seat: number,
    card: Card,
    userId: string | null = null
  ): Promise<{ view: PlayerView }> {
    const state = await this.loadRoundState(gameId);
    let nextState: RoundState;
    try {
      const move: Move = { seat, card };
      nextState = applyMove(state, move);
    } catch (err) {
      if (err instanceof InvalidMoveError) {
        await this.audit.record({
          action: "game.move.invalid",
          actorId: userId,
          target: gameId,
          meta: asJson({ seat, card: { suit: card.suit, rank: card.rank }, reason: err.message }),
        });
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    // Persistenz: Move-Row in PG anlegen, RoundState in Redis updaten.
    const seq = state.completed_tricks.length * 4 + state.current_trick_cards.length + 1;
    await this.prisma.move.create({
      data: {
        gameId,
        seq,
        seat,
        cardIndex: cardIndex(card),
        trickIdx: state.trick_idx, // alter trick_idx — die Karte gehört noch zum laufenden Trick
        userId,
      },
    });

    await this.writeRoundStateToRedis(gameId, nextState);

    // Game-Ende behandeln: Score persistieren + Audit.
    if (isRoundDone(nextState)) {
      const score = finalRoundScore(nextState);
      await this.prisma.game.update({
        where: { id: gameId },
        data: {
          endedAt: new Date(),
          finalScore: asJson({
            team_card_points: [...score.team_card_points],
            matsch_team: score.matsch_team,
            trick_winners: [...score.trick_winners],
          }),
        },
      });
      await this.audit.record({
        action: "game.finished",
        target: gameId,
        meta: asJson({
          team_card_points: [...score.team_card_points],
          matsch_team: score.matsch_team,
        }),
      });
    }

    return { view: await this.viewForSeat(gameId, seat) };
  }

  // ───────────────────────────────────────────────────────────────────
  // KI-Auto-Step
  // ───────────────────────────────────────────────────────────────────

  /**
   * Liefert die KI-Konfig für den **als-Nächstes-am-Zug**-Sitz, oder `null`
   * wenn entweder die Runde fertig ist oder ein menschlicher Spieler dran ist.
   *
   * Vom Gateway nach jedem akzeptierten Move aufgerufen, um eine Auto-Step-
   * Loop zu treiben (siehe GameGateway).
   */
  async nextAISeat(gameId: string): Promise<{ seat: number; aiSeatType: string } | null> {
    const state = await this.loadRoundState(gameId);
    if (isRoundDone(state)) return null;
    const seat = whoseTurn(state);
    const row = await this.prisma.gameSeat.findUnique({
      where: { gameId_seat: { gameId, seat } },
    });
    if (!row) {
      throw new NotFoundException(`GameSeat ${gameId}#${seat} nicht gefunden`);
    }
    if (row.userId !== null || row.aiSeatType === null) return null; // Mensch ist dran
    return { seat, aiSeatType: row.aiSeatType };
  }

  /**
   * Wählt für einen KI-Sitz die nächste Karte. Der konkrete Player-Typ
   * (`random` jetzt, `nn-vX.Y.Z` in M5) wird in `aiSeatType` mitgegeben.
   *
   * Pure-Read: schreibt nichts in DB/Redis — der Aufrufer muss anschließend
   * `playMoveAsSeat()` ausführen.
   */
  async aiChooseMove(gameId: string, seat: number, aiSeatType: string): Promise<Card> {
    const state = await this.loadRoundState(gameId);
    const view = viewAsPlayer(state, seat);
    const hand = handOf(state, seat);
    const player = pickAIPlayer(aiSeatType);
    return Promise.resolve(player.chooseCard(hand, view));
  }

  // ───────────────────────────────────────────────────────────────────
  // Redis-State-Helpers
  // ───────────────────────────────────────────────────────────────────

  private async loadRoundState(gameId: string): Promise<RoundState> {
    const raw = await this.redis.client.get(redisStateKey(gameId));
    if (!raw) {
      throw new NotFoundException(`Game ${gameId} hat keinen aktiven RoundState im Cache`);
    }
    return JSON.parse(raw) as RoundState;
  }

  private async writeRoundStateToRedis(gameId: string, state: RoundState): Promise<void> {
    await this.redis.client.set(
      redisStateKey(gameId),
      JSON.stringify(state),
      "EX",
      REDIS_STATE_TTL_SECONDS
    );
  }

  // ───────────────────────────────────────────────────────────────────
  // Hilfsfunktionen
  // ───────────────────────────────────────────────────────────────────

  /** Sucht den Sitz für einen User; wirft, wenn er nicht am Tisch sitzt. */
  private async findSeatForUser(gameId: string, userId: string): Promise<number> {
    const seat = await this.prisma.gameSeat.findFirst({
      where: { gameId, userId },
    });
    if (!seat) {
      throw new ConflictException(`User ${userId} sitzt nicht an Tisch ${gameId}`);
    }
    return seat.seat;
  }
}

// ─────────────────────────────────────────────────────────────────────
// RNG-Helpers
// ─────────────────────────────────────────────────────────────────────

/** Kryptographisch sichere Zufallsfunktion in [0, 1). */
function cryptoRng(): RandomFn {
  return () => {
    // 6 Bytes = 48 Bit Entropie → reicht für unsere Fisher-Yates-Schritte.
    const buf = randomBytes(6);
    let acc = 0;
    for (let i = 0; i < 6; i++) acc = acc * 256 + (buf[i] as number);
    return acc / 0x1_0000_0000_0000;
  };
}

/** Deterministische LCG-RNG für Tests/Replays. */
function seededRng(seed: number): RandomFn {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function variantToEnum(_v: Variant): GameVariant {
  // Aktuell nur KREUZ_4P; spätere Varianten werden hier diskriminiert
  // (z.B. KREUZ_STEIGERN mit Bieter-Variante in M12+).
  return "KREUZ_4P";
}

function suitToInt(s: Card["suit"]): number {
  switch (s) {
    case "EICHEL":
      return 0;
    case "SCHELLE":
      return 1;
    case "HERZ":
      return 2;
    case "LAUB":
      return 3;
  }
}

/**
 * Cast für Prisma-InputJsonValue. Strikte TS-Indexsignatur-Checks verbieten
 * den direkten Pass unserer Domain-Types; semantisch ist das aber JSON-fähig
 * (string/number/boolean/null/array/object). Eine zentrale Stelle hält die
 * `as unknown as`-Akrobatik aus den Use-Sites raus.
 */
function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/**
 * Dispatch des KI-Player-Typs anhand des `aiSeatType`-Strings aus dem
 * GameSeat-Record.
 *
 * Erweiterung (M5+): `nn-v0.5.0` → NNInferencePlayer, der den HTTP-Client zum
 * Inferenz-Microservice nutzt. Mit jedem NN-Release kann ein neuer Suffix
 * dazukommen, ohne dass bestehende Spiele brechen — der `aiSeatType`-String
 * dokumentiert, gegen welche Version gespielt wurde.
 */
function pickAIPlayer(aiSeatType: string): AIPlayer {
  if (aiSeatType === "random") return new RandomLegalMovePlayer();
  throw new Error(`Unknown aiSeatType: ${aiSeatType}`);
}
