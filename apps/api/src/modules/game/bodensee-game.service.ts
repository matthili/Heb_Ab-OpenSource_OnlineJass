/**
 * **Bodensee-Game-Service** — server-autoritativer Spiel-Loop für die
 * 2-Spieler-Variante.
 *
 * Bewusst getrennt vom 4-Spieler-`GameService`: Bodensee hat einen
 * strukturell anderen `BodenseeRoundState` (2 Spieler, Tisch-Mechanik,
 * 18 Stiche, keine Weisen/Stöcke/Push). Geteilt werden nur die
 * Infrastruktur-Bausteine — Prisma, Redis, Audit, Inference-Client.
 *
 * Redis-Layout (eigene Keys, damit ein Bodensee-State nie vom
 * Kreuz-`GameService` fehlinterpretiert wird):
 *   `game:{id}:bstate`   — aktiver `BodenseeRoundState` (JSON)
 *   `game:{id}:bpending` — Ansage-Phase (hands + tables + announcerIdx)
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

import {
  announceConstraints,
  applyBodenseeMove,
  bodenseeEncoderInput,
  bodenseeHandOf,
  bodenseeViewAsPlayer,
  cardIndex,
  dealBodensee,
  encodeBodenseeState,
  finalBodenseeScore,
  findWeliHolderBodensee,
  InvalidBodenseeMoveError,
  isBodenseeRoundDone,
  legalActionMaskBodensee,
  newBodenseeRound,
  SPEC_VERSION,
  visibleTableCards,
  whoseTurnBodensee,
  isAnnouncementAllowed,
  type AnnounceLevel,
  type Announcement,
  type BodenseeRoundState,
  type Card,
  type PlayMode,
  type Suit,
  type TableStack,
} from "@jass/engine";

import { AuditService } from "../audit/audit.service.js";
import {
  InferenceClient,
  InferenceUnavailableError,
} from "../inference/inference-client.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { BodenseeHeuristicPlayer } from "./players/bodensee-heuristic-player.js";

const REDIS_TTL_SECONDS = 6 * 60 * 60;

/** Zustandsloser Heuristik-Player (deterministisch) — Ansage + leichte Karten-KI. */
const BODENSEE_HEURISTIC = new BodenseeHeuristicPlayer();

function bstateKey(gameId: string): string {
  return `game:${gameId}:bstate`;
}
function bpendingKey(gameId: string): string {
  return `game:${gameId}:bpending`;
}

/** Ansage-Phase: Karten ausgeteilt, Variante noch offen. */
interface BodenseePending {
  hands: Card[][];
  tables: TableStack[][];
  announcerIdx: number;
  /** Erlaubte-Ansagen-Stufe (optional → alte Pending-Objekte = ALLES). */
  announceLevel?: AnnounceLevel;
}

/** Sitz-Zuordnung für ein Bodensee-Game (genau 2). */
export interface BodenseeSeatAssignment {
  seat: number; // 0 | 1
  userId: string | null;
  aiSeatType: string | null;
}

export interface CreateBodenseeGameInput {
  seats: readonly BodenseeSeatAssignment[];
  rngSeed?: number;
  tableId?: string;
  /**
   * Expliziter Ansager (Sitz 0|1). Wird beim Re-Match innerhalb eines Matches
   * gesetzt, damit der Ansager alterniert. Ohne Angabe bestimmt der WELI-Halter
   * den Ansager (Match-Start, Vorarlberger Tradition).
   */
  announcerSeat?: number;
  /** Erlaubte Ansage-Arten. Default: vom Tisch geladen bzw. ALLES. */
  announceLevel?: AnnounceLevel;
}

/**
 * Tisch-Stapel in der Client-Sicht. Die `hidden`-Karte selbst ist auch
 * für den Besitzer geheim — nur `hasHidden` wird übertragen.
 */
export interface TableStackView {
  visible: Card | null;
  hasHidden: boolean;
}

/** Per-Sitz-Client-Sicht auf ein Bodensee-Game. */
export interface BodenseePlayerView {
  gameId: string;
  variant: "bodensee";
  status: "announcing" | "playing" | "finished";
  mySeat: number;
  hand: readonly Card[];
  /** Eigene 6 Tisch-Stapel (visible sichtbar, hidden nur als Flag). */
  ownTable: readonly TableStackView[];
  /**
   * Gegner-Tisch-Stapel — positionsgleich zu `ownTable`: `visible` ist
   * öffentlich (die sichtbare Tisch-Karte), `hasHidden` markiert nur, dass an
   * dieser Position noch eine verdeckte Karte liegt. Der Wert der verdeckten
   * Karte bleibt geheim (wird nie übertragen). So kann das UI die Verdeckte
   * positionsgenau unter ihre offene Karte legen — wie am echten Tisch.
   */
  opponentTable: readonly TableStackView[];
  opponentHandCount: number;
  /** 36-Bit-Maske; leer in `announcing`. */
  legalActionMask: readonly number[];
  whoseTurnSeat: number;
  myTurn: boolean;
  /** Effektive Variante (gesetzt ab `playing`). */
  playMode?: PlayMode;
  trumpSuit?: Suit;
  /** Stabiles Slalom-Flag der Ansage (für Modus-Symbol/Overlay). */
  slalom?: boolean;
  trickIdx: number;
  ownScore: number;
  oppScore: number;
  /** Karten im laufenden Stich (0–2) plus der anspielende Sitz. */
  currentTrick: { cards: readonly Card[]; starter: number };
  /** Zuletzt abgeschlossener Stich — bleibt sichtbar, bis der nächste beginnt. */
  lastTrick?: { cards: readonly Card[]; starter: number; winner: number };
  /** Erster Stich der Runde — dauerhaft als Mini angezeigt (wie regulär). */
  firstTrick?: { cards: readonly Card[]; starter: number; winner: number };
  announcement?: {
    announcerSeat: number;
    iAmAnnouncer: boolean;
    announceLevel: AnnounceLevel;
  };
  finalScore?: {
    player_total_points: readonly number[];
    matsch_player: number | null;
  };
}

@Injectable()
export class BodenseeGameService {
  private readonly log = new Logger(BodenseeGameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly inference: InferenceClient
  ) {}

  // ───────────────────────────────────────────────────────────────────
  // Game-Anlage
  // ───────────────────────────────────────────────────────────────────

  async createGame(input: CreateBodenseeGameInput): Promise<{ gameId: string }> {
    if (input.seats.length !== 2) {
      throw new BadRequestException("Bodensee-Jass braucht genau 2 Sitze.");
    }
    const userIds = input.seats.map((s) => s.userId).filter((u): u is string => u !== null);
    if (new Set(userIds).size !== userIds.length) {
      throw new BadRequestException("Ein User darf nicht zwei Sitze haben.");
    }

    const { hands, tables } = dealBodensee(
      input.rngSeed !== undefined ? seededRng(input.rngSeed) : cryptoRng()
    );
    // Match-Start: der WELI-Halter sagt an. Innerhalb eines Matches übergibt
    // der Caller den (alternierenden) Ansager explizit.
    const announcerIdx = input.announcerSeat ?? findWeliHolderBodensee(hands, tables);

    // Erlaubte-Ansagen-Stufe: explizit > vom Tisch geladen > ALLES.
    const announceLevel: AnnounceLevel =
      input.announceLevel ??
      (input.tableId
        ? ((
            await this.prisma.lobbyTable.findUnique({
              where: { id: input.tableId },
              select: { announceLevel: true },
            })
          )?.announceLevel ?? "ALLES")
        : "ALLES");

    const game = await this.prisma.$transaction(async (tx) => {
      const created = await tx.game.create({
        data: {
          variant: "BODENSEE_2P",
          announceLevel,
          ruleVersion: SPEC_VERSION,
          ...(input.tableId !== undefined ? { tableId: input.tableId } : {}),
        },
      });
      if (input.tableId !== undefined) {
        await tx.lobbyTable.update({
          where: { id: input.tableId },
          data: { status: "IN_GAME", currentGameId: created.id },
        });
      }
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
          mode: "PENDING",
          starter: announcerIdx,
          weisen: {},
        },
      });
      return created;
    });

    await this.writePending(game.id, { hands, tables, announcerIdx, announceLevel });
    await this.audit.record({
      action: "bodensee.game.created",
      target: game.id,
      meta: asJson({ announcerIdx, seats: input.seats }),
    });
    this.log.log({ gameId: game.id, announcerIdx }, "Bodensee-Game angelegt");
    return { gameId: game.id };
  }

  // ───────────────────────────────────────────────────────────────────
  // Ansage
  // ───────────────────────────────────────────────────────────────────

  async applyAnnouncementAsSeat(
    gameId: string,
    seat: number,
    announcement: Announcement
  ): Promise<{ view: BodenseePlayerView }> {
    const pending = await this.loadPending(gameId);
    if (!pending) throw new BadRequestException("Spiel ist nicht im Ansage-Modus.");
    if (seat !== pending.announcerIdx) {
      throw new BadRequestException(
        `Sitz ${seat} darf nicht ansagen (Ansager: ${pending.announcerIdx}).`
      );
    }
    // Erlaubte-Ansagen-Stufe des Tisches server-seitig durchsetzen.
    const level: AnnounceLevel = pending.announceLevel ?? "ALLES";
    if (!isAnnouncementAllowed(announcement, level)) {
      throw new BadRequestException(
        `Ansage ${announcement.slalom ? "SLALOM" : announcement.variant.mode} ist an diesem Tisch nicht erlaubt.`
      );
    }
    const state = newBodenseeRound({
      announcement,
      hands: pending.hands,
      tables: pending.tables,
      announcerIdx: pending.announcerIdx,
    });
    await this.prisma.roundDecision.update({
      where: { gameId_roundIdx: { gameId, roundIdx: 0 } },
      data: {
        mode: announcement.variant.mode,
        trumpSuit:
          announcement.variant.trump_suit !== undefined
            ? suitToInt(announcement.variant.trump_suit)
            : null,
        slalom: announcement.slalom,
        // Initialen Deal persistieren, damit das Replay die Runde vollständig
        // (inkl. verdeckter Tisch-Karten) nachbauen kann — die Moves allein
        // reichen für Bodensee nicht.
        bodenseeDeal: asJson({ hands: pending.hands, tables: pending.tables }),
      },
    });
    await this.writeState(gameId, state);
    await this.redis.client.del(bpendingKey(gameId));
    await this.audit.record({
      action: "bodensee.announce",
      target: gameId,
      meta: asJson({ seat, mode: announcement.variant.mode }),
    });
    return { view: await this.viewForSeat(gameId, seat) };
  }

  /** Ansage durch einen menschlichen Spieler — löst userId → Sitz auf. */
  async applyAnnouncementAsUser(
    gameId: string,
    userId: string,
    announcement: Announcement
  ): Promise<{ view: BodenseePlayerView }> {
    return this.applyAnnouncementAsSeat(
      gameId,
      await this.findSeatForUser(gameId, userId),
      announcement
    );
  }

  // ───────────────────────────────────────────────────────────────────
  // Sicht
  // ───────────────────────────────────────────────────────────────────

  async viewForUser(gameId: string, userId: string): Promise<BodenseePlayerView> {
    return this.viewForSeat(gameId, await this.findSeatForUser(gameId, userId));
  }

  async viewForSeat(gameId: string, seat: number): Promise<BodenseePlayerView> {
    const pending = await this.loadPending(gameId);
    if (pending) {
      return {
        gameId,
        variant: "bodensee",
        status: "announcing",
        mySeat: seat,
        hand: pending.hands[seat] ?? [],
        ownTable: (pending.tables[seat] ?? []).map(toStackView),
        opponentTable: (pending.tables[1 - seat] ?? []).map(toStackView),
        opponentHandCount: (pending.hands[1 - seat] ?? []).length,
        legalActionMask: [],
        whoseTurnSeat: -1,
        myTurn: false,
        trickIdx: 0,
        ownScore: 0,
        oppScore: 0,
        currentTrick: { cards: [], starter: -1 },
        announcement: {
          announcerSeat: pending.announcerIdx,
          iAmAnnouncer: pending.announcerIdx === seat,
          announceLevel: pending.announceLevel ?? "ALLES",
        },
      };
    }

    const state = await this.loadState(gameId);
    const view = bodenseeViewAsPlayer(state, seat);
    const finished = isBodenseeRoundDone(state);
    const hand = bodenseeHandOf(state, seat);
    const ownTable = state.tables[seat] ?? [];
    const mask = finished
      ? []
      : Array.from(
          legalActionMaskBodensee({
            ...bodenseeEncoderInput(state, seat),
          })
        );
    const result: BodenseePlayerView = {
      gameId,
      variant: "bodensee",
      status: finished ? "finished" : "playing",
      mySeat: seat,
      hand,
      ownTable: ownTable.map(toStackView),
      opponentTable: (state.tables[1 - seat] ?? []).map(toStackView),
      opponentHandCount: view.opponent_hand_count,
      legalActionMask: mask,
      whoseTurnSeat: finished ? -1 : whoseTurnBodensee(state),
      myTurn: !finished && whoseTurnBodensee(state) === seat,
      playMode: state.variant.mode,
      slalom: state.announcement.slalom,
      trickIdx: state.trick_idx,
      ownScore: view.own_score,
      oppScore: view.opp_score,
      currentTrick: {
        cards: view.current_trick_cards,
        starter: view.current_trick_starter,
      },
    };
    const completed = view.completed_tricks;
    if (completed.length > 0) {
      const first = completed[0]!;
      result.firstTrick = {
        cards: first.cards,
        starter: first.starter,
        winner: state.trick_winners[0] ?? -1,
      };
      const last = completed[completed.length - 1]!;
      result.lastTrick = {
        cards: last.cards,
        starter: last.starter,
        winner: state.trick_winners[completed.length - 1] ?? -1,
      };
    }
    if (state.variant.trump_suit !== undefined) result.trumpSuit = state.variant.trump_suit;
    if (finished) {
      const score = finalBodenseeScore(state);
      result.finalScore = {
        player_total_points: score.player_total_points,
        matsch_player: score.matsch_player,
      };
    }
    return result;
  }

  // ───────────────────────────────────────────────────────────────────
  // Move
  // ───────────────────────────────────────────────────────────────────

  async playMoveAsUser(
    gameId: string,
    userId: string,
    card: Card
  ): Promise<{ view: BodenseePlayerView }> {
    return this.playMoveAsSeat(gameId, await this.findSeatForUser(gameId, userId), card, userId);
  }

  async playMoveAsSeat(
    gameId: string,
    seat: number,
    card: Card,
    userId: string | null = null
  ): Promise<{ view: BodenseePlayerView }> {
    const state = await this.loadState(gameId);
    let nextState: BodenseeRoundState;
    try {
      nextState = applyBodenseeMove(state, { player: seat, card });
    } catch (err) {
      if (err instanceof InvalidBodenseeMoveError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    // Move-Persistenz: seq = bisher gespielte Karten + 1.
    const seq = state.completed_tricks.length * 2 + state.current_trick_cards.length + 1;
    await this.prisma.move.create({
      data: { gameId, seq, seat, cardIndex: cardIndex(card), trickIdx: state.trick_idx, userId },
    });
    await this.writeState(gameId, nextState);

    if (isBodenseeRoundDone(nextState)) {
      await this.handleGameEnd(gameId, nextState);
    }
    return { view: await this.viewForSeat(gameId, seat) };
  }

  /** Score persistieren, Audit, LobbyTable auf POST_GAME / MATCH_OVER. */
  private async handleGameEnd(gameId: string, state: BodenseeRoundState): Promise<void> {
    const score = finalBodenseeScore(state);
    const updated = await this.prisma.game.update({
      where: { id: gameId },
      data: {
        endedAt: new Date(),
        finalScore: asJson({
          team_card_points: [...score.player_total_points],
          matsch_team: score.matsch_player,
          trick_winners: [...score.trick_winners],
        }),
      },
      select: { tableId: true },
    });
    let matchOver = false;
    if (updated.tableId) {
      const p0 = score.player_total_points[0] ?? 0;
      const p1 = score.player_total_points[1] ?? 0;
      const after = await this.prisma.lobbyTable.update({
        where: { id: updated.tableId },
        data: {
          cumulativeScoreTeam0: { increment: p0 },
          cumulativeScoreTeam1: { increment: p1 },
        },
        select: { targetScore: true, cumulativeScoreTeam0: true, cumulativeScoreTeam1: true },
      });
      matchOver =
        after.cumulativeScoreTeam0 >= after.targetScore ||
        after.cumulativeScoreTeam1 >= after.targetScore;
      await this.prisma.lobbyTable.update({
        where: { id: updated.tableId },
        data: { status: matchOver ? "MATCH_OVER" : "POST_GAME" },
      });
    }
    await this.audit.record({
      action: matchOver ? "bodensee.game.match_over" : "bodensee.game.finished",
      target: gameId,
      meta: asJson({ player_total_points: [...score.player_total_points] }),
    });
  }

  // ───────────────────────────────────────────────────────────────────
  // KI
  // ───────────────────────────────────────────────────────────────────

  /** Welche KI-Aktion steht an? `null` = Mensch dran oder Spiel vorbei. */
  async nextAIAction(
    gameId: string
  ): Promise<
    | { kind: "announce"; seat: number; aiSeatType: string }
    | { kind: "move"; seat: number; aiSeatType: string }
    | null
  > {
    const seatTypes = await this.aiSeatTypes(gameId);
    const pending = await this.loadPending(gameId);
    if (pending) {
      const ai = seatTypes.get(pending.announcerIdx);
      return ai ? { kind: "announce", seat: pending.announcerIdx, aiSeatType: ai } : null;
    }
    const state = await this.loadState(gameId);
    if (isBodenseeRoundDone(state)) return null;
    const turn = whoseTurnBodensee(state);
    const ai = seatTypes.get(turn);
    return ai ? { kind: "move", seat: turn, aiSeatType: ai } : null;
  }

  /**
   * KI-Ansage über die Bodensee-Heuristik (Pool = Hand + sichtbarer Tisch),
   * gebunden an die Erlaubte-Ansagen-Stufe des Tisches. Nutzen ALLE KI-Typen
   * (auch NN — das NN-Modell entscheidet nur Karten, nicht die Ansage).
   */
  async aiChooseAnnouncement(gameId: string, seat: number): Promise<Announcement> {
    const pending = await this.loadPending(gameId);
    if (!pending) throw new BadRequestException("Kein Ansage-Modus.");
    const pool = [...(pending.hands[seat] ?? []), ...visibleTableCards(pending.tables[seat] ?? [])];
    const constraints = announceConstraints(pending.announceLevel ?? "ALLES");
    return BODENSEE_HEURISTIC.chooseAnnouncement(pool, constraints);
  }

  /**
   * KI-Move je nach Sitz-Typ:
   *   - `heuristic` → Bodensee-Heuristik (leichterer Gegner, ohne NN),
   *   - `random`    → zufällig-legal,
   *   - sonst (`nn` / `nn-*`) → Inferenz-Service, bei Ausfall Fallback zufällig.
   */
  async aiChooseMove(gameId: string, seat: number, aiSeatType: string): Promise<Card> {
    const state = await this.loadState(gameId);
    const encInput = bodenseeEncoderInput(state, seat);
    const mask = legalActionMaskBodensee(encInput);
    const legalCards: Card[] = [];
    const ownTable = state.tables[seat] ?? [];
    const pool = [...(state.hands[seat] ?? []), ...visibleTableCards(ownTable)];
    for (const c of pool) {
      if (mask[cardIndex(c)] === 1) legalCards.push(c);
    }
    if (legalCards.length === 0) {
      throw new Error("aiChooseMove: keine legale Karte gefunden.");
    }

    // Leichtere Gegner: Sitz-Typ ehren, ohne das NN zu fragen.
    if (aiSeatType === "random") {
      return legalCards[Math.floor(Math.random() * legalCards.length)] as Card;
    }
    if (aiSeatType === "heuristic") {
      return BODENSEE_HEURISTIC.chooseCard(legalCards, state.current_trick_cards, state.variant);
    }

    try {
      const vec = encodeBodenseeState(encInput);
      const res = await this.inference.predict({
        gameType: "bodensee",
        state: Array.from(vec),
        mask: Array.from(mask),
      });
      // argmax → Karte. Muss im legalen Pool sein.
      const chosen = legalCards.find((c) => cardIndex(c) === res.argmax);
      if (chosen) return chosen;
      this.log.warn({ gameId, argmax: res.argmax }, "Bodensee-KI: argmax nicht im Pool — Fallback");
    } catch (err) {
      if (!(err instanceof InferenceUnavailableError)) throw err;
      this.log.warn({ gameId }, "Bodensee-Inferenz nicht verfügbar — Fallback zufällig");
    }
    // Fallback: zufällig-legal.
    return legalCards[Math.floor(Math.random() * legalCards.length)] as Card;
  }

  // ───────────────────────────────────────────────────────────────────
  // Disconnect-Handling
  // ───────────────────────────────────────────────────────────────────

  /**
   * IDs laufender Bodensee-Games, in denen der User einen noch nicht
   * KI-ersetzten Sitz hat. Für das Disconnect-Handling im Gateway.
   */
  async getActiveGameIdsForUser(userId: string): Promise<string[]> {
    const seats = await this.prisma.gameSeat.findMany({
      where: {
        userId,
        replacedByAiSeatType: null,
        game: { variant: "BODENSEE_2P", endedAt: null },
      },
      select: { gameId: true },
    });
    return seats.map((s) => s.gameId);
  }

  /**
   * Ersetzt den Sitz eines getrennten Spielers durch eine KI. Idempotent —
   * gibt `false` zurück, wenn der Sitz nicht (mehr) existiert oder schon
   * ersetzt war. Der Aufrufer treibt danach die KI-Loop weiter.
   */
  async replaceSeatWithAi(gameId: string, userId: string): Promise<boolean> {
    const res = await this.prisma.gameSeat.updateMany({
      where: { gameId, userId, replacedByAiSeatType: null },
      data: { replacedByAiSeatType: "heuristic" },
    });
    if (res.count > 0) {
      await this.audit.record({
        action: "bodensee.seat.replaced_by_ai",
        target: gameId,
        meta: asJson({ userId }),
      });
    }
    return res.count > 0;
  }

  // ───────────────────────────────────────────────────────────────────
  // Redis-Helfer
  // ───────────────────────────────────────────────────────────────────

  private async writeState(gameId: string, state: BodenseeRoundState): Promise<void> {
    await this.redis.client.set(bstateKey(gameId), JSON.stringify(state), "EX", REDIS_TTL_SECONDS);
  }

  private async loadState(gameId: string): Promise<BodenseeRoundState> {
    const raw = await this.redis.client.get(bstateKey(gameId));
    if (!raw) throw new NotFoundException(`Bodensee-Game ${gameId} hat keinen aktiven State.`);
    return JSON.parse(raw) as BodenseeRoundState;
  }

  private async writePending(gameId: string, pending: BodenseePending): Promise<void> {
    await this.redis.client.set(
      bpendingKey(gameId),
      JSON.stringify(pending),
      "EX",
      REDIS_TTL_SECONDS
    );
  }

  private async loadPending(gameId: string): Promise<BodenseePending | null> {
    const raw = await this.redis.client.get(bpendingKey(gameId));
    return raw ? (JSON.parse(raw) as BodenseePending) : null;
  }

  // ───────────────────────────────────────────────────────────────────
  // DB-Helfer
  // ───────────────────────────────────────────────────────────────────

  private async findSeatForUser(gameId: string, userId: string): Promise<number> {
    const row = await this.prisma.gameSeat.findFirst({
      where: { gameId, userId },
      select: { seat: true },
    });
    if (!row) throw new NotFoundException("Du sitzt nicht an diesem Tisch.");
    return row.seat;
  }

  /** Map Sitz → effektiver aiSeatType (nur KI-Sitze). */
  private async aiSeatTypes(gameId: string): Promise<Map<number, string>> {
    const seats = await this.prisma.gameSeat.findMany({
      where: { gameId },
      select: { seat: true, userId: true, aiSeatType: true, replacedByAiSeatType: true },
    });
    const m = new Map<number, string>();
    for (const s of seats) {
      if (s.userId === null && s.aiSeatType) m.set(s.seat, s.aiSeatType);
      else if (s.replacedByAiSeatType) m.set(s.seat, s.replacedByAiSeatType);
    }
    return m;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Freie Helfer
// ──────────────────────────────────────────────────────────────────────

function toStackView(s: TableStack): TableStackView {
  return { visible: s.visible, hasHidden: s.hidden !== null };
}

function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

function suitToInt(s: Suit): number {
  return { EICHEL: 0, SCHELLE: 1, HERZ: 2, LAUB: 3 }[s];
}

/** Kryptografischer RNG für faires Mischen. */
function cryptoRng(): () => number {
  return () => randomBytes(4).readUInt32BE(0) / 0x1_0000_0000;
}

/** Deterministischer LCG-RNG für Tests. */
function seededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0x1_0000_0000;
  };
}
