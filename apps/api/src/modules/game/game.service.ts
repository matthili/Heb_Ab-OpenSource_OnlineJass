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
  type PlayMode,
  type RandomFn,
  type RoundState,
  type Suit,
  type Variant,
  applyMove,
  cardIndex,
  dealCards,
  finalRoundScore,
  handOf,
  InvalidMoveError,
  isRoundDone,
  isWeli,
  legalActionMask,
  newRound,
  SPEC_VERSION,
  viewAsPlayer,
  whoseTurn,
} from "@jass/engine";

import { AuditService } from "../audit/audit.service.js";
import { InferenceUnavailableError } from "../inference/inference-client.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { AIPlayerFactory } from "./players/ai-player.factory.js";
import { HeuristicPlayer } from "./players/heuristic-player.js";
import { RandomLegalMovePlayer } from "./players/random-player.js";

const REDIS_STATE_TTL_SECONDS = 6 * 60 * 60; // 6h ohne Move → State läuft ab

function redisStateKey(gameId: string): string {
  return `game:${gameId}:state`;
}

/**
 * Pending-Announcement-Key: solange dieser Redis-Key existiert, ist das
 * Spiel im **Ansage-Modus** — Hände sind ausgeteilt, aber die Variante
 * steht noch nicht fest. Sobald die Ansage gemacht ist, wird der echte
 * RoundState in `redisStateKey` geschrieben und der Pending-Key gelöscht.
 *
 * Inhalt (JSON):
 *   {
 *     hands: Card[][],          // 4 × 9, in Sitz-Reihenfolge
 *     announcerSeat: number,    // 0..3, wer aktuell ansagen muss
 *     pushedFromSeat: number | null, // null = noch nicht gepusht
 *   }
 */
function redisPendingKey(gameId: string): string {
  return `game:${gameId}:pending`;
}

interface PendingAnnouncement {
  hands: Card[][];
  announcerSeat: number;
  /** Wenn schon einmal gepusht wurde: vom welchen Sitz. Partner darf nicht zurückpushen. */
  pushedFromSeat: number | null;
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
  /**
   * **Mit Variant**: Spiel startet sofort im Spiel-Modus (alter Pfad, für
   * Tests und für Re-Match-Pfade, die die Variante schon kennen).
   *
   * **Ohne Variant**: Spiel startet im Ansage-Modus (Sprint C). Der
   * Service teilt die Karten aus, bestimmt den Ansager (siehe
   * `announcerSeat`), und wartet auf einen `applyAnnouncement`-Aufruf.
   */
  variant?: Variant;
  /** Startansage. Pflicht, wenn `variant` gesetzt ist; sonst ignoriert. */
  announcement?: Announcement;
  /**
   * Welcher Sitz beginnt? Pflicht bei `variant`-Modus; im Ansage-Modus
   * wird der Starter implizit zum Ansager gesetzt (Vorarlberger Tradition:
   * der Ansager kommt raus, außer er hat an den Partner gepusht).
   */
  starter?: number;
  /**
   * Ansage-Modus: welcher Sitz darf ansagen? `undefined` = vom Service
   * bestimmt:
   *   - Wenn Hände bekannt: WELI-Inhaber (Vorarlberger Tradition, Spiel 1)
   *   - Sonst: Sitz 0 (Owner — fallback)
   */
  announcerSeat?: number;
  /** 4 Einträge, je einer pro Sitz. */
  seats: readonly SeatAssignment[];
  /** Optionaler Seed für deterministisches Mischen (Tests). */
  rngSeed?: number;
  /**
   * Optional: zugeordneter LobbyTable. Wird seit M6-C bei jedem normalen
   * Game-Start gesetzt; Tests, die das Game direkt am GameService anlegen,
   * können den Parameter weglassen (Pre-M6-Modus).
   */
  tableId?: string;
  /**
   * Optional: vorab gemischte Hände (z.B. wenn die Lobby für den WELI-
   * Re-Match-Modus den WELI-Inhaber bestimmen muss, bevor das Game
   * angelegt wird). Wenn nicht gesetzt, mischt `createGame` selbst per
   * `dealCards(rng)`.
   */
  hands?: readonly (readonly Card[])[];
}

/**
 * Was eine Client-Sicht enthält. Drei Phasen:
 *
 *   - **announcing**: Karten sind ausgeteilt, aber die Variante muss erst
 *     gewählt werden. `state` ist null, `announcement.{...}` ist gesetzt.
 *     Die eigene Hand ist trotzdem sichtbar (man sucht ja seine Ansage
 *     aus der Hand-Stärke aus).
 *   - **playing**: regulärer Spiel-Modus mit `state`, `legalActionMask`,
 *     `whoseTurnSeat`, `myTurn`.
 *   - **finished**: Spielende mit `finalScore`.
 *
 * Wir nutzen kein discriminated union, weil das in vielen Stellen
 * im Frontend nervig wäre — stattdessen optionale Felder mit klarer
 * Status-Diskriminierung.
 */
export interface PlayerView {
  gameId: string;
  status: "announcing" | "playing" | "finished";
  /** Eigener Sitz im Game (0..3). In allen Phasen verfügbar. */
  mySeat: number;
  /** Nur in `playing`/`finished` gesetzt. */
  state: GameState | null;
  hand: readonly Card[];
  /** In `announcing`: leer; in `playing`/`finished`: 36-Bit-Maske. */
  legalActionMask: readonly number[];
  /** In `announcing`: -1; in `playing`: 0..3; in `finished`: -1. */
  whoseTurnSeat: number;
  myTurn: boolean;
  /** Nur in `announcing` gesetzt. */
  announcement?: {
    /** Wer muss ansagen? Absoluter Sitz 0..3. */
    announcerSeat: number;
    iAmAnnouncer: boolean;
    /** Darf der aktuelle Announcer noch pushen? Nur true bei `pushedFromSeat===null` und Ansager==Original. */
    canPush: boolean;
    /** Wenn schon gepusht wurde, von wem (Partner darf nicht zurückpushen). */
    pushedFromSeat: number | null;
  };
  finalScore?: {
    team_card_points: readonly number[];
    matsch_team: number | null;
    trick_winners: readonly number[];
  };
}

/**
 * Eingabe für `applyAnnouncement`. Entweder eine konkrete Ansage oder
 * ein Push-Wunsch (an den Partner).
 */
export type AnnouncementDecision =
  | {
      kind: "announce";
      mode: PlayMode;
      /** Pflicht bei `mode === "TRUMPF" | "GUMPF"`. */
      trumpSuit?: Suit;
      /** True bei Slalom — Modus startet mit `mode` (OBEN oder UNTEN). */
      slalom?: boolean;
    }
  | { kind: "push" };

@Injectable()
export class GameService {
  private readonly log = new Logger(GameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly aiFactory: AIPlayerFactory
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

    // Hände entweder vom Caller mitgebracht (Re-Match-WELI-Pfad, M6-E) oder
    // hier frisch gemischt. Validierung: genau 4 Hände à 9 Karten.
    const hands =
      input.hands ??
      dealCards(input.rngSeed !== undefined ? seededRng(input.rngSeed) : cryptoRng());
    if (hands.length !== 4 || hands.some((h) => h.length !== 9)) {
      throw new BadRequestException("hands müssen genau 4 Sitze × 9 Karten enthalten");
    }

    // Modus-Entscheidung: Variant gesetzt → Direkt-Modus (M4-Pfad, Tests);
    // sonst → Ansage-Modus (Sprint C, Frontend-Pfad).
    const isAnnouncingMode = input.variant === undefined;

    // Bei Ansage-Modus: Announcer bestimmen.
    //   1. explizit übergeben → den nutzen
    //   2. sonst WELI-Inhaber suchen (Vorarlberger Tradition Spiel 1)
    //   3. Fallback: Sitz 0
    const announcerSeat = isAnnouncingMode
      ? (input.announcerSeat ?? findWeliHolder(hands) ?? 0)
      : null;

    // Im Direkt-Modus: Variant + Announcement + Starter müssen vollständig sein.
    if (!isAnnouncingMode) {
      if (!input.announcement) {
        throw new BadRequestException("Direkt-Modus braucht announcement.");
      }
      if (input.starter === undefined) {
        throw new BadRequestException("Direkt-Modus braucht starter.");
      }
    }

    const state = isAnnouncingMode
      ? null
      : newRound({
          variant: input.variant!,
          announcement: input.announcement!,
          hands: hands as Card[][],
          starter: input.starter!,
        });

    // Game + GameSeats + RoundDecision in einer Transaktion anlegen. `seats`
    // ist eine Relation auf GameSeat-Rows, keine Json-Spalte am Game-Model.
    const game = await this.prisma.$transaction(async (tx) => {
      const created = await tx.game.create({
        data: {
          variant: variantToEnum(),
          ruleVersion: SPEC_VERSION,
          ...(input.tableId !== undefined ? { tableId: input.tableId } : {}),
        },
      });
      // M6-C: wenn das Game zu einem LobbyTable gehört, geht der Tisch auf
      // IN_GAME, und currentGameId zeigt auf das neu erstellte Game. Wir
      // machen das hier in derselben Transaktion, damit niemals ein „Tisch
      // ohne aktives Game"-Halbzustand sichtbar wird.
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
      // RoundDecision wird auch im Ansage-Modus angelegt — mit Platzhaltern,
      // die durch `applyAnnouncement` später überschrieben werden. So bleibt
      // das Schema konsistent (jedes Game hat genau eine RoundDecision pro
      // Runde), und Replays/Statistiken erkennen den Eintrag auch dann,
      // wenn jemand das Spiel vor der Ansage verlässt.
      await tx.roundDecision.create({
        data: {
          gameId: created.id,
          roundIdx: 0,
          mode: isAnnouncingMode ? "PENDING" : input.variant!.mode,
          trumpSuit:
            !isAnnouncingMode && input.variant!.trump_suit !== undefined
              ? suitToInt(input.variant!.trump_suit)
              : null,
          starter: isAnnouncingMode ? announcerSeat! : input.starter!,
          weisen: {},
        },
      });
      return created;
    });

    if (isAnnouncingMode) {
      await this.writePendingToRedis(game.id, {
        hands: hands as Card[][],
        announcerSeat: announcerSeat!,
        pushedFromSeat: null,
      });
    } else {
      await this.writeRoundStateToRedis(game.id, state!);
    }

    await this.audit.record({
      action: "game.created",
      target: game.id,
      meta: asJson({
        mode: isAnnouncingMode ? "PENDING" : input.variant!.mode,
        trumpSuit: input.variant?.trump_suit ?? null,
        starter: isAnnouncingMode ? announcerSeat : input.starter,
        announcerSeat: isAnnouncingMode ? announcerSeat : null,
        seats: input.seats,
      }),
    });
    this.log.log({ gameId: game.id, announcing: isAnnouncingMode, announcerSeat }, "Game created");
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
   * Diskriminiert nach Game-Phase: announcing → Ansage-View, sonst
   * playing/finished.
   */
  async viewForSeat(gameId: string, seat: number): Promise<PlayerView> {
    const pending = await this.loadPending(gameId);
    if (pending) {
      const hand = pending.hands[seat] ?? [];
      // canPush nur für den Original-Ansager (vor einem Push). Nach einem
      // Push ist `pushedFromSeat` gesetzt → kein Zurück mehr.
      const canPush = pending.pushedFromSeat === null;
      return {
        gameId,
        status: "announcing",
        mySeat: seat,
        state: null,
        hand,
        legalActionMask: [],
        whoseTurnSeat: -1,
        myTurn: false,
        announcement: {
          announcerSeat: pending.announcerSeat,
          iAmAnnouncer: pending.announcerSeat === seat,
          canPush,
          pushedFromSeat: pending.pushedFromSeat,
        },
      };
    }
    const state = await this.loadRoundState(gameId);
    const gs = viewAsPlayer(state, seat);
    const hand = handOf(state, seat);
    const mask = legalActionMask(hand, gs);
    const finished = isRoundDone(state);
    const view: PlayerView = {
      gameId,
      status: finished ? "finished" : "playing",
      mySeat: seat,
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

    // Game-Ende behandeln: Score persistieren + Audit + ggf. LobbyTable
    // auf POST_GAME (für Re-Match-Voting in M6-E).
    if (isRoundDone(nextState)) {
      const score = finalRoundScore(nextState);
      const updated = await this.prisma.game.update({
        where: { id: gameId },
        data: {
          endedAt: new Date(),
          finalScore: asJson({
            team_card_points: [...score.team_card_points],
            matsch_team: score.matsch_team,
            trick_winners: [...score.trick_winners],
          }),
        },
        select: { tableId: true },
      });
      // M6-C: wenn das Game zu einem LobbyTable gehört, Tisch in
      // POST_GAME setzen. `currentGameId` bleibt auf diesem Game stehen,
      // bis das Re-Match-Voting (M6-E) den nächsten Übergang macht.
      if (updated.tableId) {
        await this.prisma.lobbyTable.update({
          where: { id: updated.tableId },
          data: { status: "POST_GAME" },
        });
      }
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
  // Ansage (Sprint C)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Wendet eine Ansage-Entscheidung an. Für menschliche Spieler vom Gateway
   * via `applyAnnouncementAsUser` aufgerufen, für KI vom Auto-Step-Loop
   * via `applyAnnouncementAsSeat`.
   *
   * Validierung:
   *   - Spiel muss im Pending-Zustand sein (sonst BadRequest)
   *   - Sitz muss der aktuelle Announcer sein
   *   - Bei `push`: Original-Announcer (nicht der Partner) darf pushen,
   *     nur einmal pro Spiel
   *   - Bei `announce`: Mode muss konsistent sein (TRUMPF/GUMPF brauchen
   *     trumpSuit, Slalom nur mit OBEN/UNTEN als Start)
   */
  async applyAnnouncementAsUser(
    gameId: string,
    userId: string,
    decision: AnnouncementDecision
  ): Promise<{ view: PlayerView }> {
    const seat = await this.findSeatForUser(gameId, userId);
    return this.applyAnnouncementAsSeat(gameId, seat, decision, userId);
  }

  async applyAnnouncementAsSeat(
    gameId: string,
    seat: number,
    decision: AnnouncementDecision,
    actorId: string | null = null
  ): Promise<{ view: PlayerView }> {
    const pending = await this.loadPending(gameId);
    if (!pending) {
      throw new BadRequestException("Spiel ist nicht im Ansage-Modus.");
    }
    if (seat !== pending.announcerSeat) {
      throw new BadRequestException(
        `Sitz ${seat} ist nicht am Ansagen (aktuell: ${pending.announcerSeat}).`
      );
    }

    if (decision.kind === "push") {
      // Push: an den Partner schieben. Nur erlaubt, wenn noch nicht gepusht
      // wurde — Partner darf nicht zurück.
      if (pending.pushedFromSeat !== null) {
        throw new BadRequestException("Schieben nicht erlaubt — der Partner hat schon übernommen.");
      }
      const partnerSeat = (seat + 2) % 4;
      const next: PendingAnnouncement = {
        hands: pending.hands,
        announcerSeat: partnerSeat,
        pushedFromSeat: seat,
      };
      await this.writePendingToRedis(gameId, next);
      await this.audit.record({
        action: "game.announce.push",
        actorId,
        target: gameId,
        meta: asJson({ from: seat, to: partnerSeat }),
      });
      return { view: await this.viewForSeat(gameId, seat) };
    }

    // Reguläre Ansage. Validate.
    const ann = buildAnnouncement(decision);

    // Starter ist nach Vorarlberger Tradition immer der Original-Ansager —
    // auch wenn er gepusht hat. `pushedFromSeat` wenn gesetzt → der ist
    // Starter, sonst der aktuelle (=original) Announcer.
    const starter = pending.pushedFromSeat !== null ? pending.pushedFromSeat : seat;

    // RoundState bauen und in Redis schreiben.
    const state = newRound({
      variant: ann.variant,
      announcement: ann,
      hands: pending.hands,
      starter,
    });

    // RoundDecision updaten (Platzhalter überschreiben).
    await this.prisma.roundDecision.update({
      where: { gameId_roundIdx: { gameId, roundIdx: 0 } },
      data: {
        mode: ann.variant.mode,
        trumpSuit: ann.variant.trump_suit !== undefined ? suitToInt(ann.variant.trump_suit) : null,
        starter,
      },
    });
    await this.writeRoundStateToRedis(gameId, state);
    await this.redis.client.del(redisPendingKey(gameId));

    await this.audit.record({
      action: "game.announce.decided",
      actorId,
      target: gameId,
      meta: asJson({
        seat,
        mode: ann.variant.mode,
        trumpSuit: ann.variant.trump_suit ?? null,
        slalom: ann.slalom,
        wasPushed: pending.pushedFromSeat !== null,
        originalAnnouncer: pending.pushedFromSeat ?? seat,
        starter,
      }),
    });
    return { view: await this.viewForSeat(gameId, seat) };
  }

  // ───────────────────────────────────────────────────────────────────
  // KI-Auto-Step
  // ───────────────────────────────────────────────────────────────────

  /**
   * Liefert das nächste KI-Aktion-Subjekt:
   *   - `"announce"`: das Spiel ist im Pending-Zustand, der Announcer ist
   *     ein KI-Sitz. Caller muss `applyAnnouncementAsSeat` mit einer von
   *     `aiChooseAnnouncement` gewählten Entscheidung aufrufen.
   *   - `"move"`: regulärer Move-Schritt wie bisher.
   *   - `null`: ein menschlicher Spieler ist dran, oder das Spiel ist
   *     beendet.
   */
  async nextAIAction(
    gameId: string
  ): Promise<{ kind: "announce" | "move"; seat: number; aiSeatType: string } | null> {
    const pending = await this.loadPending(gameId);
    if (pending) {
      const row = await this.prisma.gameSeat.findUnique({
        where: { gameId_seat: { gameId, seat: pending.announcerSeat } },
      });
      if (!row) {
        throw new NotFoundException(`GameSeat ${gameId}#${pending.announcerSeat} nicht gefunden`);
      }
      if (row.userId !== null || row.aiSeatType === null) return null;
      return { kind: "announce", seat: pending.announcerSeat, aiSeatType: row.aiSeatType };
    }
    const next = await this.nextAISeat(gameId);
    if (!next) return null;
    return { kind: "move", ...next };
  }

  /**
   * Legacy-Alias für den alten `nextAISeat`-Pfad — bleibt für M4-Tests
   * verfügbar, die direkt den Move-Schritt treiben.
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
   * Wählt für einen KI-Sitz die Ansage. Nutzt aktuell den `HeuristicPlayer`
   * — für `aiSeatType=random` und `nn` greift dieser Fallback ebenfalls,
   * weil weder Random noch das NN-Modell eine eigene Ansage-Logik haben
   * (das NN-Modell ist auf Karten-Wahl trainiert, nicht auf Ansage).
   *
   * Pure-Read.
   */
  async aiChooseAnnouncement(gameId: string, seat: number): Promise<AnnouncementDecision> {
    const pending = await this.loadPending(gameId);
    if (!pending) {
      throw new BadRequestException("Spiel ist nicht im Ansage-Modus.");
    }
    const hand = pending.hands[seat] ?? [];
    const canPush = pending.pushedFromSeat === null;
    const heur = new HeuristicPlayer();
    const ann = heur.chooseAnnouncement(hand, canPush);
    if (ann === null) {
      // HeuristicPlayer wollte pushen; Partner muss dann entscheiden.
      return { kind: "push" };
    }
    return {
      kind: "announce",
      mode: ann.variant.mode,
      ...(ann.variant.trump_suit !== undefined ? { trumpSuit: ann.variant.trump_suit } : {}),
      slalom: ann.slalom,
    };
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
    const player = this.aiFactory.create(aiSeatType);
    try {
      return await Promise.resolve(player.chooseCard(hand, view));
    } catch (err) {
      // Fallback bei jedem Inferenz-Problem auf Random-Legal-Move. So bleibt
      // das Spiel spielbar, selbst wenn der Inferenz-Microservice down oder
      // überlastet ist. Wir loggen das aber prominent, damit Ops es sieht.
      if (err instanceof InferenceUnavailableError) {
        this.log.warn(
          { gameId, seat, aiSeatType, err: err.message },
          "Inferenz nicht verfügbar — Fallback auf RandomLegalMovePlayer"
        );
        await this.audit.record({
          action: "game.ai.inference_fallback",
          target: gameId,
          meta: asJson({ seat, aiSeatType, reason: err.message }),
        });
        return new RandomLegalMovePlayer().chooseCard(hand, view);
      }
      throw err;
    }
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

  private async loadPending(gameId: string): Promise<PendingAnnouncement | null> {
    const raw = await this.redis.client.get(redisPendingKey(gameId));
    if (!raw) return null;
    return JSON.parse(raw) as PendingAnnouncement;
  }

  private async writePendingToRedis(gameId: string, pending: PendingAnnouncement): Promise<void> {
    await this.redis.client.set(
      redisPendingKey(gameId),
      JSON.stringify(pending),
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

function variantToEnum(): GameVariant {
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
 * Sucht den Sitz, der das WELI (Schelle-Sechs) auf der Hand hat. Wird in
 * Spiel 1 zur Bestimmung des Ansagers genutzt (Vorarlberger Tradition).
 * Bei `null`: kein Sitz hat das WELI (sollte nie passieren, weil das WELI
 * Teil des regulären 36er-Decks ist — defensiver Fallback).
 */
function findWeliHolder(hands: readonly (readonly Card[])[]): number | null {
  for (let seat = 0; seat < hands.length; seat++) {
    const hand = hands[seat];
    if (hand && hand.some((c) => isWeli(c))) return seat;
  }
  return null;
}

/**
 * Validiert eine `AnnouncementDecision` vom Typ `announce` und baut daraus
 * ein konkretes `Announcement`-Objekt für die Engine. Wirft, wenn z.B.
 * TRUMPF ohne trumpSuit oder SLALOM mit TRUMPF kombiniert wird.
 */
function buildAnnouncement(decision: AnnouncementDecision & { kind: "announce" }): Announcement {
  const mode = decision.mode;
  const slalom = decision.slalom ?? false;

  if (slalom && (mode === "TRUMPF" || mode === "GUMPF")) {
    throw new BadRequestException("Slalom kann nicht mit TRUMPF/GUMPF kombiniert werden.");
  }
  if ((mode === "TRUMPF" || mode === "GUMPF") && decision.trumpSuit === undefined) {
    throw new BadRequestException(`Ansage ${mode} braucht trumpSuit.`);
  }
  if (mode !== "TRUMPF" && mode !== "GUMPF" && decision.trumpSuit !== undefined) {
    throw new BadRequestException(`Ansage ${mode} darf keinen trumpSuit haben.`);
  }

  const variant: Variant =
    decision.trumpSuit !== undefined ? { mode, trump_suit: decision.trumpSuit } : { mode };
  return { variant, slalom };
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
