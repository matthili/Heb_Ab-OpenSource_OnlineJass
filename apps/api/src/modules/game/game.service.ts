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
 * Design-Hinweise:
 *   - Ein `Game` = eine Runde (`round_idx = 0`); eine ganze Partie über mehrere
 *     Spiele läuft über den Re-Match-Flow der Lobby (jeweils ein neues `Game`).
 *   - Die Variante wird im Ansage-Modus gewählt (Trumpf-Ansage inkl. Schieben).
 *   - Single-Owner-pro-Tisch ist über den `GameLockService` (Redis) aktiv.
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
  announceStoeck,
  applyMove,
  cardIndex,
  clickWeisenButton,
  cutDeck,
  dealCards,
  dealFromDeck,
  finalRoundScore,
  handOf,
  InvalidMoveError,
  isRoundDone,
  isWeli,
  announceConstraints,
  isAnnouncementAllowed,
  type AnnounceLevel,
  legalActionMask,
  newRound,
  SOLO_TEAMS,
  SPEC_VERSION,
  submitWeisen,
  validateDeclaration,
  viewAsPlayer,
  weisenSeatStatus,
  weisenWindowOpen,
  whoseTurn,
  findBestWeisenForHand,
  aggregateWeisen,
  type WeisDeclaration,
} from "@jass/engine";
import { aiName } from "@jass/shared-types";

import { AuditService } from "../audit/audit.service.js";
import {
  InferenceClient,
  InferenceUnavailableError,
} from "../inference/inference-client.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { AIPlayerFactory } from "./players/ai-player.factory.js";
import {
  HeuristicPlayer,
  KREUZ_ANNOUNCE_PARAMS,
  SOLO_ANNOUNCE_PARAMS,
} from "./players/heuristic-player.js";

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

function redisCutKey(gameId: string): string {
  return `game:${gameId}:cut`;
}

/**
 * **Cut-Pending** — die kurze „Abheben"-Phase VOR dem Austeilen. Der Server
 * hat gemischt (`deck`, 36 Karten ungeschnitten), wartet aber noch auf den
 * Abheber, bevor die Hände entstehen. Nur in Folgespielen (Ansager steht
 * schon fest); der WELI-Deal (Spiel 1) wird nicht abgehoben.
 */
interface CutPending {
  /** Gemischtes, noch nicht abgehobenes Deck (36 Karten). */
  deck: Card[];
  /** Wer hebt ab? Rechts vom Geber = (announcerSeat + 2) % 4. */
  cutterSeat: number;
  /** Steht schon fest (Folgespiel) — kommt nach dem Abheben raus. */
  announcerSeat: number;
  isSolo?: boolean;
  announceLevel?: AnnounceLevel;
  sackRule?: boolean;
  weisNeedsTrick?: boolean;
}

interface PendingAnnouncement {
  hands: Card[][];
  announcerSeat: number;
  /** Wenn schon einmal gepusht wurde: vom welchen Sitz. Partner darf nicht zurückpushen. */
  pushedFromSeat: number | null;
  /**
   * Solo-Jass: jeder Spieler für sich (teams=[0,1,2,3]), kein Schieben.
   * Optional, damit alte Pending-Objekte ohne das Feld als `false`
   * (= Kreuz-Jass) interpretiert werden.
   */
  isSolo?: boolean;
  /**
   * Erlaubte-Ansagen-Stufe des Tisches. Optional, damit alte Pending-Objekte
   * ohne das Feld als `ALLES` (= keine Einschränkung) interpretiert werden.
   */
  announceLevel?: AnnounceLevel;
  /** Optionale Wertungsregeln des Tisches (Default false, s. createGame). */
  sackRule?: boolean;
  weisNeedsTrick?: boolean;
  /**
   * Schiebe-Slalom-Sonderfall: Der gepushte Partner hat Slalom angesagt; offen
   * ist nur noch die Start-Richtung (Oben/Unten). Die wählt der Starter
   * (= ursprünglicher Schieber, kommt mit der ersten Karte raus), nicht der
   * Ansager. Solange gesetzt, ist `announcerSeat` dieser Starter.
   */
  slalomDirectionOnly?: boolean;
}

/** Spielart, die der Caller an `createGame` übergeben kann. */
export type GameType = "kreuz" | "solo";

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
   * Erlaubte Ansage-Arten (Tisch-Einstellung). Default `ALLES` = keine
   * Einschränkung — passt zu Tests/Direkt-Pfaden, die das Feld weglassen.
   */
  announceLevel?: AnnounceLevel;
  /**
   * Optionale Wertungsregeln (Tisch-Einstellung). Default `false`. Werden
   * wie `announceLevel` aufgelöst (explizit > Tisch > aus) und aufs Game
   * sowie die Engine-Runde (`newRound`) durchgereicht.
   */
  sackRule?: boolean;
  weisNeedsTrick?: boolean;
  /**
   * Echtes Abheben (Tisch-Einstellung). Greift nur, wenn der Ansager schon
   * feststeht (= Folgespiele); der WELI-Deal (Spiel 1) wird nie abgehoben.
   * Default `false`.
   */
  cutEnabled?: boolean;
  /**
   * Optional: vorab gemischte Hände (z.B. wenn die Lobby für den WELI-
   * Re-Match-Modus den WELI-Inhaber bestimmen muss, bevor das Game
   * angelegt wird). Wenn nicht gesetzt, mischt `createGame` selbst per
   * `dealCards(rng)`.
   */
  hands?: readonly (readonly Card[])[];
  /**
   * Spielart. `kreuz` (Default) = Team-Spiel (Sitz 0+2 vs 1+3).
   * `solo` = jeder gegen jeden (teams=[0,1,2,3]), kein Schieben.
   * Bestimmt die Team-Konfiguration der Engine, den DB-`GameVariant`
   * und welches NN-Modell die KI nutzt.
   */
  gameType?: GameType;
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
  /** Inferenz-Service erreichbar? Steuert den Engine-Status-Tooltip am KI-Sitz;
   * bei `false` spielen NN-Sitze über den Heuristik-Fallback. */
  inferenceAvailable: boolean;
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
    /** Erlaubte-Ansagen-Stufe des Tisches — der Dialog blendet gesperrte Modi aus. */
    announceLevel: AnnounceLevel;
    /**
     * Schiebe-Slalom: der Partner hat Slalom angesagt, offen ist nur noch die
     * Start-Richtung (Oben/Unten), die DU als Starter wählst. Der Dialog zeigt
     * dann nur den Richtungs-Picker.
     */
    slalomDirectionOnly: boolean;
  };
  /**
   * Nur in der „Abheben"-Phase gesetzt (status bleibt `announcing`, aber
   * `announcement` ist dann nicht gesetzt). Die Karten sind noch nicht
   * ausgeteilt; gewartet wird auf den Abheber.
   */
  cut?: {
    /** Wer hebt ab (absoluter Sitz 0..3). */
    cutterSeat: number;
    /** Bin ich der Abheber? */
    iAmCutter: boolean;
    /** Deckgröße (für den Schieberegler 1..deckSize-1). */
    deckSize: number;
  };
  finalScore?: {
    team_card_points: readonly number[];
    matsch_team: number | null;
    trick_winners: readonly number[];
    /** Teams, deren Punkte durch Sack/Kein-Stich verfallen sind (für die UI-Meldung). */
    voided?: readonly {
      team: number;
      reason: "sack" | "no_trick";
      cardPoints: number;
      lostPoints: number;
    }[];
  };
  /**
   * **Stöck**: ist der eigene Sitz gerade zum Stöck-Ansagen berechtigt?
   * (= Spieler hat soeben die zweite Trumpf-OBER/KOENIG-Karte gespielt
   *  und noch nicht angesagt + noch nicht den nächsten Zug gemacht.)
   * Wird der Client nutzen, um den „Stöck rufen (+20)"-Button zu zeigen.
   */
  stoeckEligible: boolean;
  /** Team, das offiziell Stöck angesagt hat — nur informativ (für UI-Anzeige). */
  stoeckAnnouncedTeam?: number | null;

  /**
   * **Weisen-Status für den eigenen Sitz** — Frontend rendert das Weisen-UI
   * abhängig davon (Button zeigen / Selection-Mode / SUBMITTED-Markierung).
   */
  weisen: {
    /** Status für den eigenen Sitz. */
    myStatus: "PENDING" | "OPEN" | "SUBMITTED" | "MISSED" | "EVALUATED";
    /** Ist der Klick auf den „Weisen"-Button aktuell erlaubt? */
    canClickButton: boolean;
    /** Eigene bereits submitten Deklarationen. */
    myDeclarations: ReadonlyArray<WeisDeclarationView>;
    /**
     * Wenn die Aggregation gelaufen ist (Trick 1 vorbei): die submitten
     * Weisen ALLER Sitze sowie das Sieger-Team. Vorher: undefined.
     */
    result?: {
      winningTeam: number | null;
      points: number;
      perSeat: ReadonlyArray<{ seat: number; declarations: WeisDeclarationView[] }>;
    };
  };
}

/**
 * Weis-View für den Client. Wir reichen genug Info durch, dass das
 * Frontend den Weis korrekt rendern kann (Karten + Punkte + Kind).
 */
export interface WeisDeclarationView {
  kind: string;
  cards: ReadonlyArray<{ suit: string; rank: string }>;
  points: number;
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
    private readonly aiFactory: AIPlayerFactory,
    private readonly inference: InferenceClient
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
    // Im WELI-Ermittlungs-Spiel (Spiel 1, kein announcerSeat) dienen diese
    // Hände NUR zur Bestimmung des Ansagers (WELI-Halter) — beim echten
    // Abheben mischt der Geber danach neu (`dealCards(rng).flat()`).
    const rng = input.rngSeed !== undefined ? seededRng(input.rngSeed) : cryptoRng();
    const hands = input.hands ?? dealCards(rng);
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

    // Spielart → Team-Konfiguration. Solo: jeder sein eigenes Team.
    const isSolo = (input.gameType ?? "kreuz") === "solo";
    const teams = isSolo ? SOLO_TEAMS : undefined; // undefined → Engine-Default

    // Erlaubte-Ansagen-Stufe: explizit übergeben > vom zugehörigen Tisch
    // geladen > Default ALLES. So bleibt die Einschränkung an EINER Stelle
    // (kein Durchreichen durch alle Aufrufer / Re-Match-Pfade nötig).
    const tableRules = input.tableId
      ? await this.prisma.lobbyTable.findUnique({
          where: { id: input.tableId },
          select: {
            announceLevel: true,
            sackRule: true,
            weisNeedsTrick: true,
            cutEnabled: true,
          },
        })
      : null;
    const announceLevel: AnnounceLevel =
      input.announceLevel ?? tableRules?.announceLevel ?? "ALLES";
    // Optionale Wertungsregeln: explizit > Tisch > aus (analog announceLevel).
    const sackRule = input.sackRule ?? tableRules?.sackRule ?? false;
    const weisNeedsTrick = input.weisNeedsTrick ?? tableRules?.weisNeedsTrick ?? false;
    const cutEnabled = input.cutEnabled ?? tableRules?.cutEnabled ?? false;

    // **Echtes Abheben**: vor JEDEM echten Austeilen — auch Spiel 1. Der
    // Ansager steht hier immer fest (Folgespiel: übergeben; Spiel 1:
    // WELI-Halter aus der Ermittlung oben). Die WELI-Ermittlung selbst ist
    // das einzige Austeilen ohne Abheben — und die ist hier bereits gelaufen
    // (die `hands` oben), bevor der Geber für die echte Runde neu mischt.
    // Abheber = rechts vom Geber = (Ansager + 2) % 4 (Geber = Ansager − 1).
    const shouldCut = isAnnouncingMode && cutEnabled;

    const state = isAnnouncingMode
      ? null
      : newRound({
          variant: input.variant!,
          announcement: input.announcement!,
          hands: hands as Card[][],
          starter: input.starter!,
          ...(teams !== undefined ? { teams } : {}),
          sackRule,
          weisNeedsTrick,
        });

    // Game + GameSeats + RoundDecision in einer Transaktion anlegen. `seats`
    // ist eine Relation auf GameSeat-Rows, keine Json-Spalte am Game-Model.
    const game = await this.prisma.$transaction(async (tx) => {
      const created = await tx.game.create({
        data: {
          variant: variantToEnum(input.gameType ?? "kreuz"),
          announceLevel,
          sackRule,
          weisNeedsTrick,
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
            // KI-Namen beim Spielstart einfrieren (Seed = tableId, wie live) →
            // unveränderlich im Archiv. Menschen-Sitze bleiben null.
            aiDisplayName: s.aiSeatType
              ? aiName(`${input.tableId ?? created.id}:${s.seat}`, s.aiSeatType)
              : null,
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

    if (shouldCut) {
      // Noch nicht austeilen — erst hebt der Abheber ab. Der Geber mischt für
      // die echte Runde NEU (frischer Shuffle, unabhängig von der oben evtl.
      // gelaufenen WELI-Ermittlung). Erst nach dem Abheben wird verteilt.
      const deck = dealCards(rng).flat();
      await this.writeCutToRedis(game.id, {
        deck,
        cutterSeat: (announcerSeat! + 2) % 4,
        announcerSeat: announcerSeat!,
        isSolo,
        announceLevel,
        sackRule,
        weisNeedsTrick,
      });
    } else if (isAnnouncingMode) {
      await this.writePendingToRedis(game.id, {
        hands: hands as Card[][],
        announcerSeat: announcerSeat!,
        pushedFromSeat: null,
        isSolo,
        announceLevel,
        sackRule,
        weisNeedsTrick,
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
    const inferenceAvailable = this.inference.isAvailable();
    // Abheben-Phase: Karten noch nicht ausgeteilt, gewartet wird auf den
    // Abheber. status bleibt „announcing", aber `cut` statt `announcement`.
    const cut = await this.loadCut(gameId);
    if (cut) {
      return {
        gameId,
        status: "announcing",
        mySeat: seat,
        state: null,
        hand: [],
        legalActionMask: [],
        whoseTurnSeat: -1,
        myTurn: false,
        cut: {
          cutterSeat: cut.cutterSeat,
          iAmCutter: cut.cutterSeat === seat,
          deckSize: cut.deck.length,
        },
        inferenceAvailable,
        stoeckEligible: false,
        stoeckAnnouncedTeam: null,
        weisen: {
          myStatus: "PENDING",
          canClickButton: false,
          myDeclarations: [],
        },
      };
    }
    const pending = await this.loadPending(gameId);
    if (pending) {
      const hand = pending.hands[seat] ?? [];
      // canPush nur für den Original-Ansager (vor einem Push). Nach einem
      // Push ist `pushedFromSeat` gesetzt → kein Zurück mehr. Im Solo-Jass
      // gibt es kein Schieben (kein Partner) → immer false.
      const canPush = !pending.isSolo && pending.pushedFromSeat === null;
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
          announceLevel: pending.announceLevel ?? "ALLES",
          slalomDirectionOnly: pending.slalomDirectionOnly ?? false,
        },
        inferenceAvailable,
        stoeckEligible: false,
        stoeckAnnouncedTeam: null,
        weisen: {
          myStatus: "PENDING",
          canClickButton: false,
          myDeclarations: [],
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
      inferenceAvailable,
      status: finished ? "finished" : "playing",
      mySeat: seat,
      state: gs,
      hand,
      legalActionMask: Array.from(mask),
      whoseTurnSeat: finished ? -1 : whoseTurn(state),
      myTurn: !finished && whoseTurn(state) === seat,
      stoeckEligible: !finished && state.stoeck_eligible_seat === seat,
      stoeckAnnouncedTeam: state.stoeck_announced_team,
      weisen: buildWeisenView(state, seat),
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
    // auf POST_GAME (für Re-Match-Voting in M6-E) oder MATCH_OVER, falls
    // das **Punkteziel** über die kumulativen Scores erreicht wurde.
    if (isRoundDone(nextState)) {
      const score = finalRoundScore(nextState);
      // Angesagte Weis pro Sitz fürs Replay flach mitspeichern (kind + Punkte
      // reichen für die Auflistung). Verfallene Punkte (Sack / kein Stich) aus
      // dem score.voided-Array übernehmen — sonst geht beides nach Spielende
      // verloren (Redis-State ist weg, im reinen Endbetrag nicht erkennbar).
      const weis = nextState.weisen_declarations.flatMap((decls, seat) =>
        decls.map((d) => ({ seat, kind: d.kind, points: d.points }))
      );
      const updated = await this.prisma.game.update({
        where: { id: gameId },
        data: {
          endedAt: new Date(),
          finalScore: asJson({
            team_card_points: [...score.team_card_points],
            matsch_team: score.matsch_team,
            trick_winners: [...score.trick_winners],
            ...(weis.length > 0 ? { weis } : {}),
            ...(score.voided && score.voided.length > 0
              ? { voided: score.voided.map((v) => ({ ...v })) }
              : {}),
          }),
        },
        select: { tableId: true },
      });
      // M6-C / Punkteziel-Sprint:
      //   - Wenn das Game zu einem LobbyTable gehört, kumulative Punkte
      //     pro Team aktualisieren (Increment, damit parallele Updates
      //     atomar zusammenpassen).
      //   - Status-Übergang: erreicht/übersteigt ein Team das Punkteziel,
      //     → MATCH_OVER (Partie ist gewonnen). Sonst → POST_GAME (Re-
      //     Match-Voting möglich).
      let matchOver = false;
      if (updated.tableId) {
        // `team_card_points` hat 2 Einträge bei Kreuz, 4 bei Solo. Wir
        // incrementen alle vier DB-Konten atomar — Team2/3 sind bei Kreuz
        // schlicht +0. So zählt auch eine Solo-Partie für alle 4 Spieler
        // korrekt mit.
        const pts = score.team_card_points;
        // „Im Sack" verfallene Kartenpunkte je Team mitführen (reine Info —
        // zählen NIE zur Wertung; cumulativeScore* bleibt davon unberührt).
        const sacked = [0, 0, 0, 0];
        for (const v of score.voided ?? []) {
          if (v.reason === "sack") sacked[v.team] = (sacked[v.team] ?? 0) + v.cardPoints;
        }
        const tableAfter = await this.prisma.lobbyTable.update({
          where: { id: updated.tableId },
          data: {
            cumulativeScoreTeam0: { increment: pts[0] ?? 0 },
            cumulativeScoreTeam1: { increment: pts[1] ?? 0 },
            cumulativeScoreTeam2: { increment: pts[2] ?? 0 },
            cumulativeScoreTeam3: { increment: pts[3] ?? 0 },
            sackedPointsTeam0: { increment: sacked[0] ?? 0 },
            sackedPointsTeam1: { increment: sacked[1] ?? 0 },
            sackedPointsTeam2: { increment: sacked[2] ?? 0 },
            sackedPointsTeam3: { increment: sacked[3] ?? 0 },
          },
          select: {
            targetScore: true,
            cumulativeScoreTeam0: true,
            cumulativeScoreTeam1: true,
            cumulativeScoreTeam2: true,
            cumulativeScoreTeam3: true,
          },
        });
        // Partie gewonnen, sobald IRGENDEIN Konto das Ziel erreicht.
        const cumulatives = [
          tableAfter.cumulativeScoreTeam0,
          tableAfter.cumulativeScoreTeam1,
          tableAfter.cumulativeScoreTeam2,
          tableAfter.cumulativeScoreTeam3,
        ];
        matchOver = cumulatives.some((c) => c >= tableAfter.targetScore);
        await this.prisma.lobbyTable.update({
          where: { id: updated.tableId },
          data: { status: matchOver ? "MATCH_OVER" : "POST_GAME" },
        });
      }
      await this.audit.record({
        action: matchOver ? "game.finished.match_over" : "game.finished",
        target: gameId,
        meta: asJson({
          team_card_points: [...score.team_card_points],
          matsch_team: score.matsch_team,
          matchOver,
        }),
      });
    }

    return { view: await this.viewForSeat(gameId, seat) };
  }

  // ───────────────────────────────────────────────────────────────────
  // Stöck-Ansage
  // ───────────────────────────────────────────────────────────────────

  /**
   * Spieler ruft „Stöck". Nur erlaubt, wenn der eigene Sitz gerade
   * `stoeck_eligible_seat` ist (= zweite Trumpf-O/K wurde soeben
   * gespielt). +20 Punkte am Rundenende.
   */
  async announceStoeckAsUser(gameId: string, userId: string): Promise<{ view: PlayerView }> {
    const seat = await this.findSeatForUser(gameId, userId);
    return this.announceStoeckAsSeat(gameId, seat, userId);
  }

  async announceStoeckAsSeat(
    gameId: string,
    seat: number,
    userId: string | null = null
  ): Promise<{ view: PlayerView }> {
    const state = await this.loadRoundState(gameId);
    let nextState: RoundState;
    try {
      nextState = announceStoeck(state, seat);
    } catch (err) {
      if (err instanceof InvalidMoveError) {
        await this.audit.record({
          action: "game.stoeck.invalid",
          actorId: userId,
          target: gameId,
          meta: asJson({ seat, reason: err.message }),
        });
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    await this.writeRoundStateToRedis(gameId, nextState);
    await this.audit.record({
      action: "game.stoeck.announced",
      actorId: userId,
      target: gameId,
      meta: asJson({ seat, team: state.teams[seat] }),
    });
    return { view: await this.viewForSeat(gameId, seat) };
  }

  /**
   * Sagt einen noch offenen Stöck automatisch an — genutzt vom Gateway, wenn
   * die Stöck-Gnadenfrist (Stöck auf der letzten Karte) ohne Klick abläuft.
   * No-op, wenn die Runde schon vorbei ist, bereits ein Stöck angesagt wurde
   * oder gerade niemand berechtigt ist.
   */
  async autoAnnounceStoeckIfEligible(gameId: string): Promise<void> {
    let state: RoundState;
    try {
      state = await this.loadRoundState(gameId);
    } catch {
      return; // kein aktiver RoundState (Runde schon vorbei) → nichts zu tun
    }
    if (isRoundDone(state)) return;
    if (state.stoeck_announced_team !== null) return; // schon angesagt (Klick)
    if (state.stoeck_eligible_seat === null) return; // niemand (mehr) berechtigt
    await this.announceStoeckAsSeat(gameId, state.stoeck_eligible_seat);
  }

  // ───────────────────────────────────────────────────────────────────
  // Weisen
  // ───────────────────────────────────────────────────────────────────

  /**
   * User klickt den „Weisen"-Button. Öffnet die Karten-Selection für
   * diesen Sitz, ohne dass schon Karten ausgewählt sein müssen.
   */
  async clickWeisenAsUser(gameId: string, userId: string): Promise<{ view: PlayerView }> {
    const seat = await this.findSeatForUser(gameId, userId);
    return this.clickWeisenAsSeat(gameId, seat, userId);
  }

  async clickWeisenAsSeat(
    gameId: string,
    seat: number,
    userId: string | null = null
  ): Promise<{ view: PlayerView }> {
    const state = await this.loadRoundState(gameId);
    let nextState: RoundState;
    try {
      nextState = clickWeisenButton(state, seat);
    } catch (err) {
      if (err instanceof InvalidMoveError) {
        await this.audit.record({
          action: "game.weisen.click.invalid",
          actorId: userId,
          target: gameId,
          meta: asJson({ seat, reason: err.message }),
        });
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    await this.writeRoundStateToRedis(gameId, nextState);
    await this.audit.record({
      action: "game.weisen.click",
      actorId: userId,
      target: gameId,
      meta: asJson({ seat }),
    });
    return { view: await this.viewForSeat(gameId, seat) };
  }

  /**
   * User submittet seine Weis-Karten. Cards aus dem Frontend werden
   * server-seitig mit `validateDeclaration` durchgespielt — kein Vertrauen
   * auf die Client-Klassifizierung.
   *
   * Mehrere Weisen pro Submit erlaubt (z.B. 4 Buur + 3-Blatt) — Karten
   * müssen über die Deklarationen disjunkt sein.
   */
  async submitWeisenAsUser(
    gameId: string,
    userId: string,
    weisCardGroups: ReadonlyArray<ReadonlyArray<Card>>
  ): Promise<{ view: PlayerView }> {
    const seat = await this.findSeatForUser(gameId, userId);
    return this.submitWeisenAsSeat(gameId, seat, weisCardGroups, userId);
  }

  async submitWeisenAsSeat(
    gameId: string,
    seat: number,
    weisCardGroups: ReadonlyArray<ReadonlyArray<Card>>,
    userId: string | null = null
  ): Promise<{ view: PlayerView }> {
    const state = await this.loadRoundState(gameId);
    // Original-Hand rekonstruieren (= aktuelle Hand + ggf. schon
    // gespielte erste Karte) — wird von `validateDeclaration` benutzt.
    const originalHand: Card[] = [...state.hands[seat]!];
    for (const tr of state.completed_tricks) {
      const idx =
        (((seat - tr.starter) % state.num_players) + state.num_players) % state.num_players;
      const card = tr.cards[idx];
      if (card) originalHand.push(card);
    }
    const posInCurrent =
      (((seat - state.current_trick_starter) % state.num_players) + state.num_players) %
      state.num_players;
    if (posInCurrent < state.current_trick_cards.length) {
      originalHand.push(state.current_trick_cards[posInCurrent]!);
    }

    const declarations: WeisDeclaration[] = [];
    for (const group of weisCardGroups) {
      const v = validateDeclaration(group, originalHand);
      if ("invalid" in v) {
        await this.audit.record({
          action: "game.weisen.submit.invalid",
          actorId: userId,
          target: gameId,
          meta: asJson({ seat, reason: v.reason }),
        });
        throw new BadRequestException(`Weis ungültig: ${v.reason}`);
      }
      declarations.push(v);
    }

    let nextState: RoundState;
    try {
      nextState = submitWeisen(state, seat, declarations);
    } catch (err) {
      if (err instanceof InvalidMoveError) {
        await this.audit.record({
          action: "game.weisen.submit.invalid",
          actorId: userId,
          target: gameId,
          meta: asJson({ seat, reason: err.message }),
        });
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    await this.writeRoundStateToRedis(gameId, nextState);
    await this.audit.record({
      action: "game.weisen.submit",
      actorId: userId,
      target: gameId,
      meta: asJson({
        seat,
        count: declarations.length,
        points: declarations.reduce((s, d) => s + d.points, 0),
      }),
    });
    return { view: await this.viewForSeat(gameId, seat) };
  }

  /**
   * KI-Auto-Weisen: ein KI-Sitz klickt automatisch den Button + submittet
   * sofort alle optimalen Weisen. Wird vom `driveAIsLoop` (Gateway) nach
   * der Trumpf-Ansage UND nach jedem AI-Move im Trick 1 aufgerufen, falls
   * der KI-Sitz noch eine Weisen-Chance hat.
   *
   * No-op wenn nichts zu deklarieren ist (leere Liste) oder das Window
   * für diesen Sitz nicht (mehr) offen ist.
   */
  async aiAutoWeisenForSeat(gameId: string, seat: number): Promise<void> {
    const state = await this.loadRoundState(gameId);
    if (!weisenWindowOpen(state, seat)) return;
    if (weisenSeatStatus(state, seat) !== "PENDING") return;
    // Original-Hand rekonstruieren
    const originalHand: Card[] = [...state.hands[seat]!];
    for (const tr of state.completed_tricks) {
      const idx =
        (((seat - tr.starter) % state.num_players) + state.num_players) % state.num_players;
      const card = tr.cards[idx];
      if (card) originalHand.push(card);
    }
    const declarations = findBestWeisenForHand(originalHand);
    let next = clickWeisenButton(state, seat);
    if (declarations.length > 0) {
      next = submitWeisen(next, seat, declarations);
    }
    await this.writeRoundStateToRedis(gameId, next);
    await this.audit.record({
      action: "game.weisen.ai_auto",
      target: gameId,
      meta: asJson({
        seat,
        count: declarations.length,
        points: declarations.reduce((s, d) => s + d.points, 0),
      }),
    });
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

  // ───────────────────────────────────────────────────────────────────
  // Abheben (echtes Cut-the-Deck)
  // ───────────────────────────────────────────────────────────────────

  async applyCutAsUser(
    gameId: string,
    userId: string,
    cutIndex: number
  ): Promise<{ view: PlayerView }> {
    const seat = await this.findSeatForUser(gameId, userId);
    return this.applyCutAsSeat(gameId, seat, cutIndex, userId);
  }

  /**
   * Hebt das (gemischte) Deck real ab und teilt erst dann aus — wechselt
   * also aus der Abheben-Phase in die normale Ansage-Phase.
   *
   *   - `cutIndex` in 1..35 = abheben an dieser Stelle.
   *   - `cutIndex === 0` (oder Vielfaches von 36) = „Klopfen" (nicht abheben).
   */
  async applyCutAsSeat(
    gameId: string,
    seat: number,
    cutIndex: number,
    actorId?: string
  ): Promise<{ view: PlayerView }> {
    const cut = await this.loadCut(gameId);
    if (!cut) {
      throw new BadRequestException("Es ist gerade keine Abheben-Phase aktiv.");
    }
    if (seat !== cut.cutterSeat) {
      throw new BadRequestException(
        `Sitz ${seat} darf gerade nicht abheben (Abheber: ${cut.cutterSeat}).`
      );
    }
    // Real abheben → austeilen → in die Ansage-Phase wechseln.
    const hands = dealFromDeck(cutDeck(cut.deck, cutIndex), 4);
    await this.writePendingToRedis(gameId, {
      hands,
      announcerSeat: cut.announcerSeat,
      pushedFromSeat: null,
      ...(cut.isSolo !== undefined ? { isSolo: cut.isSolo } : {}),
      ...(cut.announceLevel !== undefined ? { announceLevel: cut.announceLevel } : {}),
      ...(cut.sackRule !== undefined ? { sackRule: cut.sackRule } : {}),
      ...(cut.weisNeedsTrick !== undefined ? { weisNeedsTrick: cut.weisNeedsTrick } : {}),
    });
    await this.redis.client.del(redisCutKey(gameId));
    const knocked = ((cutIndex % cut.deck.length) + cut.deck.length) % cut.deck.length === 0;
    await this.audit.record({
      action: "game.cut",
      ...(actorId !== undefined ? { actorId } : {}),
      target: gameId,
      meta: asJson({ seat, knocked }),
    });
    return { view: await this.viewForSeat(gameId, seat) };
  }

  /**
   * Tisch-ID zu einem Game (für die Chat-Kanal-Auflösung: System-Nachrichten
   * sollen in `table:<id>`, was der In-Game-Chat abonniert). `null` = kein
   * (mehr) verknüpfter Tisch.
   */
  async getTableIdForGame(gameId: string): Promise<string | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { tableId: true },
    });
    return game?.tableId ?? null;
  }

  /**
   * Markiert einen menschlichen Sitz als ausgestiegen — der Sitz bleibt
   * mit seiner `userId` in der DB (für Spiel-Historie und Quitter-Tracking),
   * aber `leftAt` wird gesetzt und der Sitz spielt ab dem nächsten Zug als
   * KI vom Typ `replacedByAiSeatType` weiter.
   *
   * Wird vom LobbyService.leaveTable im IN_GAME/POST_GAME-Fall aufgerufen.
   *
   * Returnt Metadaten für den Audit-Eintrag:
   *   - `seat`: welcher Sitz wurde umgeschaltet
   *   - `hadHumanOpponents`: gab es noch weitere menschliche, nicht-
   *     ausgestiegene Sitze im Spiel? (= „der Aussteiger lässt echte
   *     Mitspieler im Stich"). KI-Sitze + andere Aussteiger zählen nicht.
   *   - `wasInAnnouncing`: war der Aussteiger gerade als Ansager dran?
   */
  async markUserLeft(
    gameId: string,
    userId: string,
    replacementAiType: string = "heuristic"
  ): Promise<{
    seat: number | null;
    hadHumanOpponents: boolean;
    wasInAnnouncing: boolean;
    alreadyLeft: boolean;
  }> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { seats: true },
    });
    if (!game) throw new NotFoundException(`Game ${gameId} nicht gefunden`);
    if (game.endedAt !== null) {
      // Spiel ist schon vorbei — kein Aussteig mehr nötig, aber das ist
      // kein harter Fehler. Caller (Lobby) braucht hier nur das Signal,
      // dass nichts mehr zu tun ist.
      return { seat: null, hadHumanOpponents: false, wasInAnnouncing: false, alreadyLeft: true };
    }
    const seatRow = game.seats.find((s) => s.userId === userId && s.leftAt === null);
    if (!seatRow) {
      // User ist entweder nie an dem Tisch gewesen oder schon vorher
      // ausgestiegen. Beides ist für den Caller (Lobby-leaveTable) kein
      // Grund zum Crash — z.B. wenn der User nach einem ersten Aussteig
      // nochmal „Verlassen" klickt, um seinen Owner-Status loszuwerden.
      const earlierLeave = game.seats.find((s) => s.userId === userId && s.leftAt !== null);
      if (earlierLeave) {
        return {
          seat: earlierLeave.seat,
          hadHumanOpponents: false,
          wasInAnnouncing: false,
          alreadyLeft: true,
        };
      }
      throw new ConflictException("Du bist nicht (mehr) am Tisch.");
    }

    // hadHumanOpponents: ein anderer Sitz mit userId !== null und leftAt === null.
    const hadHumanOpponents = game.seats.some(
      (s) => s.seat !== seatRow.seat && s.userId !== null && s.leftAt === null
    );

    // Falls die Pending-Phase aktiv ist UND der Aussteiger gerade
    // Ansager war: wir markieren das, damit der WS-Gateway weiß,
    // dass nach dem Aussteig eine KI-Ansage triggern muss.
    const pending = await this.loadPending(gameId);
    const wasInAnnouncing = pending !== null && pending.announcerSeat === seatRow.seat;

    await this.prisma.gameSeat.update({
      where: { gameId_seat: { gameId, seat: seatRow.seat } },
      data: { leftAt: new Date(), replacedByAiSeatType: replacementAiType },
    });

    await this.audit.record({
      action: "game.abandoned",
      actorId: userId,
      target: gameId,
      meta: asJson({
        seat: seatRow.seat,
        hadHumanOpponents,
        wasInAnnouncing,
        replacementAiType,
      }),
    });
    this.log.warn(
      { gameId, seat: seatRow.seat, userId, hadHumanOpponents },
      "User ist aus laufendem Spiel ausgestiegen — Sitz wird zur KI"
    );
    return {
      seat: seatRow.seat,
      hadHumanOpponents,
      wasInAnnouncing,
      alreadyLeft: false,
    };
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
      // Im Slalom-Richtungs-Schritt (Schiebe-Slalom) darf nicht geschoben
      // werden — der Starter wählt nur noch Oben/Unten.
      if (pending.slalomDirectionOnly) {
        throw new BadRequestException(
          "Schieben nicht möglich — wähle nur die Slalom-Startrichtung."
        );
      }
      // Solo-Jass kennt kein Schieben — es gibt keinen Partner.
      if (pending.isSolo) {
        throw new BadRequestException("Schieben gibt es im Solo-Jass nicht.");
      }
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
        ...(pending.isSolo !== undefined ? { isSolo: pending.isSolo } : {}),
        ...(pending.announceLevel !== undefined ? { announceLevel: pending.announceLevel } : {}),
        ...(pending.sackRule !== undefined ? { sackRule: pending.sackRule } : {}),
        ...(pending.weisNeedsTrick !== undefined ? { weisNeedsTrick: pending.weisNeedsTrick } : {}),
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

    // Erlaubte-Ansagen-Stufe des Tisches server-seitig durchsetzen — ein
    // manipulierter Client könnte sonst eine gesperrte Ansage (z.B. Gumpf)
    // schicken, obwohl der Tisch sie nicht anbietet.
    const level: AnnounceLevel = pending.announceLevel ?? "ALLES";
    if (!isAnnouncementAllowed(ann, level)) {
      throw new BadRequestException(
        `Ansage ${ann.slalom ? "SLALOM" : ann.variant.mode} ist an diesem Tisch nicht erlaubt.`
      );
    }

    // Im Slalom-Richtungs-Schritt ist ausschließlich eine Slalom-Ansage zulässig.
    if (pending.slalomDirectionOnly && !ann.slalom) {
      throw new BadRequestException("Hier ist nur die Slalom-Startrichtung zu wählen.");
    }

    // **Schiebe-Slalom-Sonderregel**: Sagt der gepushte Partner Slalom an, so
    // wählt NICHT er die Start-Richtung, sondern der Schieber (= Starter, der
    // mit der ersten Karte rauskommt). Wir verschieben die Wahl an ihn: er wird
    // (erneut) zum Ansager und legt nur noch Oben/Unten fest. `slalomDirectionOnly`
    // verhindert eine Endlosschleife, falls der Starter selbst Slalom wählt.
    if (ann.slalom && pending.pushedFromSeat !== null && !pending.slalomDirectionOnly) {
      const starterSeat = pending.pushedFromSeat;
      await this.writePendingToRedis(gameId, {
        hands: pending.hands,
        announcerSeat: starterSeat,
        pushedFromSeat: starterSeat,
        ...(pending.isSolo !== undefined ? { isSolo: pending.isSolo } : {}),
        ...(pending.announceLevel !== undefined ? { announceLevel: pending.announceLevel } : {}),
        ...(pending.sackRule !== undefined ? { sackRule: pending.sackRule } : {}),
        ...(pending.weisNeedsTrick !== undefined ? { weisNeedsTrick: pending.weisNeedsTrick } : {}),
        slalomDirectionOnly: true,
      });
      await this.audit.record({
        action: "game.announce.slalom-deferred",
        actorId,
        target: gameId,
        meta: asJson({ announcer: seat, starter: starterSeat }),
      });
      return { view: await this.viewForSeat(gameId, seat) };
    }

    // Starter ist nach Vorarlberger Tradition immer der Original-Ansager —
    // auch wenn er gepusht hat. `pushedFromSeat` wenn gesetzt → der ist
    // Starter, sonst der aktuelle (=original) Announcer.
    const starter = pending.pushedFromSeat !== null ? pending.pushedFromSeat : seat;

    // RoundState bauen und in Redis schreiben. Solo: jeder sein eigenes Team.
    const state = newRound({
      variant: ann.variant,
      announcement: ann,
      hands: pending.hands,
      starter,
      ...(pending.isSolo ? { teams: SOLO_TEAMS } : {}),
      sackRule: pending.sackRule ?? false,
      weisNeedsTrick: pending.weisNeedsTrick ?? false,
    });

    // RoundDecision updaten (Platzhalter überschreiben).
    await this.prisma.roundDecision.update({
      where: { gameId_roundIdx: { gameId, roundIdx: 0 } },
      data: {
        mode: ann.variant.mode,
        trumpSuit: ann.variant.trump_suit !== undefined ? suitToInt(ann.variant.trump_suit) : null,
        starter,
        // Slalom-Flag persistieren — sonst kann das Replay die pro-Stich
        // alternierende Variante nicht rekonstruieren (mode/trumpSuit allein
        // verraten Slalom nicht).
        slalom: ann.slalom,
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
  ): Promise<{ kind: "announce" | "move" | "cut"; seat: number; aiSeatType: string } | null> {
    // Abheben-Phase: ist der Abheber eine KI, hebt sie automatisch ab.
    const cut = await this.loadCut(gameId);
    if (cut) {
      const effective = await this.effectiveAiTypeForSeat(gameId, cut.cutterSeat);
      if (effective === null) return null; // Mensch hebt ab → warten
      return { kind: "cut", seat: cut.cutterSeat, aiSeatType: effective };
    }
    const pending = await this.loadPending(gameId);
    if (pending) {
      const seat = pending.announcerSeat;
      const effective = await this.effectiveAiTypeForSeat(gameId, seat);
      if (effective === null) return null; // menschlicher Sitz ohne Aussteig
      return { kind: "announce", seat, aiSeatType: effective };
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
    const effective = await this.effectiveAiTypeForSeat(gameId, seat);
    if (effective === null) return null; // Mensch ist dran und nicht ausgestiegen
    return { seat, aiSeatType: effective };
  }

  /**
   * Server-interne KI-Auto-Loop **ohne WS-Broadcast** — bei Bedarf wenn
   * niemand mehr menschlich am Tisch ist, der die Loop sonst via
   * `game:move`/`game:announce` antreiben würde (Quitter-Sprint:
   * alle 4 Sitze sind nach Aussteig KI). Treibt das Spiel bis zum Ende
   * oder bis ein menschlicher Sitz dran ist.
   *
   * Sicherheits-Limits: 50 Move-Schritte + 2 Ansage-Schritte. Bei realen
   * Kreuz-Jass-Spielen sind das je 36 Karten + max. 1 Push pro Ansage,
   * also genug Reserve.
   */
  async driveAIsToEnd(gameId: string): Promise<void> {
    let announceSteps = 0;
    for (let i = 0; i < 50; i++) {
      let action: Awaited<ReturnType<typeof this.nextAIAction>>;
      try {
        action = await this.nextAIAction(gameId);
      } catch (err) {
        // **Robustheit**: Wenn der Redis-State zwischenzeitlich abgelaufen
        // ist (TTL 6h), ist das Game *technisch* in einem ungültigen
        // Zustand — wir können es nicht mehr deterministisch zu Ende
        // treiben. Stattdessen markieren wir das Game als beendet (mit
        // `endedAt` gesetzt) und kehren sauber zurück, damit der Caller
        // (z.B. `leaveTable`) den Tisch trotzdem schließen kann.
        if (err instanceof NotFoundException) {
          this.log.warn(
            { gameId, reason: err.message },
            "driveAIsToEnd: kein Redis-State mehr — Game wird zwangs-beendet"
          );
          await this.forceEndStaleGame(gameId);
          return;
        }
        throw err;
      }
      if (!action) return; // Mensch dran oder Spiel beendet
      if (action.kind === "announce") {
        if (++announceSteps > 2) {
          this.log.error({ gameId }, "driveAIsToEnd: Ansage-Loop > 2 Schritte — fail-safe");
          return;
        }
        const decision = await this.aiChooseAnnouncement(gameId, action.seat);
        await this.applyAnnouncementAsSeat(gameId, action.seat, decision);
        continue;
      }
      const card = await this.aiChooseMove(gameId, action.seat, action.aiSeatType);
      const { view } = await this.playMoveAsSeat(gameId, action.seat, card);
      if (view.status === "finished") return;
    }
    this.log.warn({ gameId }, "driveAIsToEnd hat Sicherheitsgrenze erreicht");
  }

  /**
   * Notfall-Cleanup für Games, deren Redis-State verschwunden ist.
   * Setzt `endedAt`, schreibt einen Audit-Eintrag — der Tisch kann
   * danach normal geschlossen werden. Keine Punkte werden vergeben
   * (Game ist effektiv null-und-nichtig).
   */
  private async forceEndStaleGame(gameId: string): Promise<void> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { endedAt: true },
    });
    if (!game || game.endedAt !== null) return; // schon erledigt
    await this.prisma.game.update({
      where: { id: gameId },
      data: { endedAt: new Date() },
    });
    await this.audit.record({
      action: "game.force_ended.stale_state",
      target: gameId,
      meta: asJson({ reason: "redis_state_missing" }),
    });
  }

  /**
   * Liefert den `aiSeatType`, der für diesen Sitz **effektiv** spielt:
   *   - Sitz ist von Anfang an KI → `aiSeatType` aus der DB
   *   - Sitz war Mensch, der ist ausgestiegen → `replacedByAiSeatType`
   *   - Sitz ist Mensch, noch dabei → `null` (= dieser Schritt ist nicht
   *     vom AI-Loop zu treiben)
   *
   * Wirft `NotFoundException`, wenn der Sitz nicht existiert.
   */
  private async effectiveAiTypeForSeat(gameId: string, seat: number): Promise<string | null> {
    const row = await this.prisma.gameSeat.findUnique({
      where: { gameId_seat: { gameId, seat } },
    });
    if (!row) {
      throw new NotFoundException(`GameSeat ${gameId}#${seat} nicht gefunden`);
    }
    // Anfangs-KI: keine userId, aiSeatType gesetzt.
    if (row.userId === null) return row.aiSeatType ?? null;
    // Mensch noch dabei.
    if (row.leftAt === null) return null;
    // Mensch ist ausgestiegen → KI vom Aussteig-Typ.
    return row.replacedByAiSeatType ?? "heuristic";
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
    // Schiebe-Slalom-Richtungs-Schritt: die KI (als Starter) wählt nur die
    // Start-Richtung — Oben als einfache, neutrale Default-Wahl.
    if (pending.slalomDirectionOnly) {
      return { kind: "announce", mode: "OBEN", slalom: true };
    }
    const hand = pending.hands[seat] ?? [];
    // Schieben gibt es nur im Kreuz-Jass (Partner) und NIE im Solo-Jass —
    // analog zur Mensch-View. Ohne den isSolo-Check böte der HeuristicPlayer
    // bei schwacher Solo-Hand ein Push an (chooseAnnouncement → null), das
    // applyAnnouncementAsSeat dann zu Recht ablehnt → früher Crash im AI-Loop.
    const canPush = !pending.isSolo && pending.pushedFromSeat === null;
    // KI an die Erlaubte-Ansagen-Stufe des Tisches binden. Alle KI-Typen
    // (random/heuristic/nn) nutzen für die Ansage den HeuristicPlayer; der
    // filtert Kandidaten nach allowedModes/allowSlalom. TRUMPF ist auf jeder
    // Stufe erlaubt → es gibt immer mindestens eine wählbare Ansage.
    const { allowedModes, allowSlalom } = announceConstraints(pending.announceLevel ?? "ALLES");
    // Getunte Ansage-Parameter je Spielart (NN-Briefings v0.7.2 Kreuz / v0.8.2 Solo).
    const tuned = pending.isSolo ? SOLO_ANNOUNCE_PARAMS : KREUZ_ANNOUNCE_PARAMS;
    const heur = new HeuristicPlayer({ allowedModes, allowSlalom, ...tuned });
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
      // Fallback bei jedem Inferenz-Problem auf die HEURISTIK (nicht random):
      // dependency-frei, deutlich stärker als Zufall — der beste Stand-in für
      // ein fehlendes NN. So bleibt das Spiel spielbar UND ordentlich, selbst
      // wenn der Inferenz-Microservice down/überlastet ist. Prominent geloggt.
      if (err instanceof InferenceUnavailableError) {
        this.log.warn(
          { gameId, seat, aiSeatType, err: err.message },
          "Inferenz nicht verfügbar — Fallback auf HeuristicPlayer"
        );
        await this.audit.record({
          action: "game.ai.inference_fallback",
          target: gameId,
          meta: asJson({ seat, aiSeatType, reason: err.message }),
        });
        return new HeuristicPlayer().chooseCard(hand, view);
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

  private async loadCut(gameId: string): Promise<CutPending | null> {
    const raw = await this.redis.client.get(redisCutKey(gameId));
    if (!raw) return null;
    return JSON.parse(raw) as CutPending;
  }

  private async writeCutToRedis(gameId: string, cut: CutPending): Promise<void> {
    await this.redis.client.set(
      redisCutKey(gameId),
      JSON.stringify(cut),
      "EX",
      REDIS_STATE_TTL_SECONDS
    );
  }

  // ───────────────────────────────────────────────────────────────────
  // Hilfsfunktionen
  // ───────────────────────────────────────────────────────────────────

  /**
   * Schließt einen Tisch wegen Disconnect (STOP-Outcome). Setzt das
   * Game auf `endedAt`, die LobbyTable auf `CLOSED` + `currentGameId=null`,
   * räumt Redis-State. Anschließend muss der Caller die Game-Sockets
   * informieren (über `game:disconnect-closed`).
   *
   * Bewusst keine Final-Score-Logik — der Spielstand wird verworfen
   * (Disconnect ist kein regulär beendetes Game). Cumulative-Scores
   * der LobbyTable bleiben unangetastet.
   */
  async closeGameForDisconnect(gameId: string, reason: string): Promise<void> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { tableId: true, endedAt: true },
    });
    if (!game) return;
    if (!game.endedAt) {
      await this.prisma.game.update({
        where: { id: gameId },
        data: { endedAt: new Date() },
      });
    }
    if (game.tableId) {
      await this.prisma.lobbyTable.update({
        where: { id: game.tableId },
        data: { status: "CLOSED", currentGameId: null, closedAt: new Date() },
      });
    }
    await this.audit.record({
      action: "lobby.table.closed.disconnect",
      target: gameId,
      meta: { reason, tableId: game.tableId ?? null },
    });
    // Redis-Game-State + Disconnect-State räumen.
    try {
      await this.redis.client.del(`game:${gameId}:state`);
      await this.redis.client.del(`game:${gameId}:disconnect`);
    } catch {
      // ignorieren — eventual cleanup ok
    }
  }

  /**
   * Liefert die aktuellen GameSeat-Verhältnisse für die Disconnect-Vote-
   * Logik: pro Sitz, ob er gerade „menschlich aktiv" (= User dabei,
   * leftAt=null) oder „KI" ist. Disconnected ≠ left — ein User, der die
   * WS-Verbindung verloren hat, hat trotzdem `leftAt=null` und zählt
   * hier als HUMAN.
   *
   * Caller (DisconnectVoteService) bekommt das als Liste von Sitzen
   * exklusive der aktuell disconnected Sitze (die zählen nicht als
   * stimmberechtigt).
   */
  async getDisconnectParticipants(
    gameId: string,
    disconnectedSeats: readonly number[]
  ): Promise<Array<{ seat: number; kind: "HUMAN" | "AI" }>> {
    const seats = await this.prisma.gameSeat.findMany({
      where: { gameId },
      orderBy: { seat: "asc" },
    });
    const result: Array<{ seat: number; kind: "HUMAN" | "AI" }> = [];
    for (const s of seats) {
      if (disconnectedSeats.includes(s.seat)) continue;
      // Mensch, der noch aktiv am Tisch sitzt (kein leftAt) → HUMAN.
      // Alles andere (initial KI, oder Aussteiger mit replacedByAi) → AI.
      const isHuman = s.userId !== null && s.leftAt === null;
      result.push({ seat: s.seat, kind: isHuman ? "HUMAN" : "AI" });
    }
    return result;
  }

  /**
   * Liefert die Game-IDs, in denen `userId` aktuell als nicht-
   * ausgestiegener Sitz steht UND das Game noch läuft (kein endedAt).
   * Wird vom Gateway beim Disconnect aufgerufen, um den Vote-Service
   * zu triggern.
   */
  async getActiveGameIdsForUser(userId: string): Promise<string[]> {
    const seats = await this.prisma.gameSeat.findMany({
      where: { userId, leftAt: null, game: { endedAt: null } },
      select: { gameId: true, seat: true },
    });
    return seats.map((s) => s.gameId);
  }

  /** Liefert die Sitz-Nummer eines Users in einem Game oder `null`. */
  async findActiveSeatForUser(gameId: string, userId: string): Promise<number | null> {
    const seat = await this.prisma.gameSeat.findFirst({
      where: { gameId, userId, leftAt: null },
      select: { seat: true },
    });
    return seat?.seat ?? null;
  }

  /**
   * Sucht den Sitz für einen User; wirft, wenn er nicht am Tisch sitzt
   * **oder** schon ausgestiegen ist (`leftAt !== null`). Damit kann ein
   * Aussteiger keine Moves oder Ansagen mehr machen.
   */
  private async findSeatForUser(gameId: string, userId: string): Promise<number> {
    const seat = await this.prisma.gameSeat.findFirst({
      where: { gameId, userId, leftAt: null },
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

function variantToEnum(gameType: GameType): GameVariant {
  // Mappt die App-Spielart auf den DB-`GameVariant`-Enum-Wert.
  // KREUZ_6P / KREUZ_STEIGERN / BODENSEE_2P kommen in späteren Sprints.
  switch (gameType) {
    case "solo":
      return "SOLO_4P";
    case "kreuz":
    default:
      return "KREUZ_4P";
  }
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
 * Sucht den Sitz, der den WELI (Schelle-Sechs) auf der Hand hat. Wird in
 * Spiel 1 zur Bestimmung des Ansagers genutzt (Vorarlberger Tradition).
 * Bei `null`: kein Sitz hat den WELI (sollte nie passieren, weil der WELI
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

/**
 * Baut den Weisen-Teil der `PlayerView` für einen Sitz. Nach Trick 1
 * (= `weisen_evaluated`) zeigen wir auch das aggregierte Result —
 * sonst ist `result` undefined.
 */
function buildWeisenView(state: RoundState, seat: number): PlayerView["weisen"] {
  const myStatus = weisenSeatStatus(state, seat);
  const canClickButton =
    myStatus === "PENDING" &&
    weisenWindowOpen(state, seat) &&
    state.weisen_button_clicked_at[seat] === null;
  const myDeclarations = (state.weisen_declarations[seat] ?? []).map(declToView);

  if (!state.weisen_evaluated) {
    return { myStatus, canClickButton, myDeclarations };
  }

  // Result: alle Submitten pro Sitz + Aggregat
  const declarationsPerSeat: Record<number, readonly WeisDeclaration[]> = {};
  for (let s = 0; s < state.num_players; s++) {
    const decls = state.weisen_declarations[s] ?? [];
    if (decls.length > 0) declarationsPerSeat[s] = decls;
  }
  // Vorhand-Bestimmung: der allererste Trick wurde von completed_tricks[0]
  // gespielt — sein `starter` ist die Vorhand.
  const firstTrick = state.completed_tricks[0];
  const vorhandSeat = firstTrick?.starter ?? 0;
  const aggregate = aggregateWeisen({
    declarationsPerSeat,
    teams: state.teams,
    trumpSuit: state.variant.trump_suit ?? null,
    vorhandSeat,
    numPlayers: state.num_players,
  });
  const perSeat: Array<{ seat: number; declarations: WeisDeclarationView[] }> = [];
  for (let s = 0; s < state.num_players; s++) {
    const decls = state.weisen_declarations[s] ?? [];
    if (decls.length > 0) {
      perSeat.push({ seat: s, declarations: decls.map(declToView) });
    }
  }
  return {
    myStatus,
    canClickButton,
    myDeclarations,
    result: {
      winningTeam: aggregate.winningTeam,
      points: aggregate.points,
      perSeat,
    },
  };
}

function declToView(d: WeisDeclaration): WeisDeclarationView {
  return {
    kind: d.kind,
    cards: d.cards.map((c) => ({ suit: c.suit, rank: c.rank })),
    points: d.points,
  };
}
