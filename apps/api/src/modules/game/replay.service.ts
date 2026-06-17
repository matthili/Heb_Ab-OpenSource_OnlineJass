/**
 * Liefert das Replay-Bundle für ein abgeschlossenes (oder laufendes) Spiel.
 *
 * **Datenquellen:**
 *   - `Game` — Meta (Variante, ruleVersion, modelVersion, startedAt, endedAt, finalScore)
 *   - `RoundDecision` — Mode, Trumpf-Farbe, Starter, Weisen (für M10 nur Runde 0)
 *   - `GameSeat` — Sitz-Zuordnung (User-ID + Anzeige-Name + KI-Typ)
 *   - `Move` — Alle Karten-Züge in `seq`-Reihenfolge
 *
 * **Hand-Rekonstruktion:** Die Initial-Hand pro Sitz wird aus den Moves
 * dieses Sitzes rekonstruiert (jeder Spieler hat genau 9 Karten gespielt =
 * seine komplette Hand). Das spart Schema-Drift: wir speichern Initial-
 * Hände nirgends, und brauchen sie auch nicht — die Moves enthalten die
 * vollständige Info.
 *
 * **Authorization:**
 *   - Teilnehmer des Tisches (jeder Sitz mit eigener `userId`) darf replayen
 *   - Admins dürfen jedes Game replayen
 *   - Andere User → 403
 *
 * **Replay ist read-only**: keine Audit-Records, kein Redis-State-Zugriff.
 * Der Client baut über `engine.applyMove` jeden Frame selbst nach.
 */
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { GameVariant } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";

export interface ReplaySeat {
  seat: number; // 0..3
  userId: string | null;
  displayName: string | null;
  aiSeatType: string | null;
}

export interface ReplayRound {
  roundIdx: number;
  mode: string; // "TRUMPF" | "GUMPF" | "OBEN" | "UNTEN"
  trumpSuit: number | null; // 0..3 oder null
  starter: number; // 0..3
  // M10 nimmt das Weisen-Json passthrough — Slot ist da, Inhalt
  // noch nicht standardisiert (kommt mit Weisen-Implementation).
  weisen: unknown;
  // Slalom-Ansage? (Modus alterniert pro Stich.) Für die Replay-Rekonstruktion.
  slalom: boolean;
  // Bodensee: initialer Deal { hands, tables } | null. Für Kreuz/Solo immer null.
  bodenseeDeal: unknown;
}

export interface ReplayMove {
  seq: number; // 1..36
  seat: number; // 0..3
  cardIndex: number; // 0..35
  trickIdx: number; // 0..8
  ts: string; // ISO
  userId: string | null;
}

export interface ReplayFinalScore {
  team_card_points: number[];
  matsch_team: number | null;
  trick_winners: number[];
  /** Angesagte Weis pro Sitz (nur Kreuz/Solo, optional bei alten Spielen). */
  weis?: { seat: number; kind: string; points: number }[];
  /** Verfallene Punkte (Sack / kein Stich) pro Team (optional). */
  voided?: { team: number; reason: "sack" | "no_trick"; cardPoints: number; lostPoints: number }[];
}

export interface ReplayBundle {
  gameId: string;
  /** Tisch der Partie — Seed für stabile KI-Namen über alle Spiele eines Tischs. */
  tableId: string | null;
  variant: GameVariant;
  ruleVersion: string;
  modelVersion: string | null;
  startedAt: string;
  endedAt: string | null;
  status: "playing" | "finished";
  finalScore: ReplayFinalScore | null;
  seats: ReplaySeat[];
  rounds: ReplayRound[];
  moves: ReplayMove[];
  /** Spec: „Öffentliche/teilbare Replays". `true` = via /public-Endpunkt einsehbar. */
  publicReplay: boolean;
}

@Injectable()
export class ReplayService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lädt das Replay-Bundle. Wirft `NotFound` bei unbekannter gameId,
   * `Forbidden` wenn der User kein Teilnehmer und kein Admin ist.
   *
   * Die Rolle wird hier selbst aus der DB gezogen — `req.user` carrying nur
   * `{id}`, und wir wollen sowieso die aktuelle Rolle (nicht den Token-Claim).
   */
  async getReplay(gameId: string, userId: string): Promise<ReplayBundle> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        seats: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { seat: "asc" },
        },
        rounds: { orderBy: { roundIdx: "asc" } },
        moves: { orderBy: { seq: "asc" } },
      },
    });
    if (!game) {
      throw new NotFoundException(`Game ${gameId} nicht gefunden`);
    }

    // Authorization: Teilnehmer-Check (oder Admin).
    const isParticipant = game.seats.some((s) => s.userId !== null && s.userId === userId);
    if (!isParticipant) {
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (me?.role !== "ADMIN") {
        throw new ForbiddenException("Replay ist nur für Teilnehmer einsehbar");
      }
    }

    return this.buildBundle(game);
  }

  /**
   * Liest ein Replay **ohne Auth-Check** — funktioniert nur, wenn der
   * `publicReplay`-Flag auf `true` steht. Für Share-Links gedacht
   * (`/r/:gameId`). Wirft `NotFound` sowohl bei unbekannter ID als auch bei
   * nicht-öffentlichem Game (Privatsphäre: kein Existenz-Leak).
   */
  async getPublicReplay(gameId: string): Promise<ReplayBundle> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        seats: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { seat: "asc" },
        },
        rounds: { orderBy: { roundIdx: "asc" } },
        moves: { orderBy: { seq: "asc" } },
      },
    });
    if (!game || !game.publicReplay) {
      throw new NotFoundException(`Öffentliches Replay ${gameId} nicht gefunden`);
    }
    return this.buildBundle(game);
  }

  /**
   * Schaltet das `publicReplay`-Flag um. Erlaubt für jeden Teilnehmer am
   * Tisch (oder Admin). Wirft `Forbidden`, wenn der User keinen Sitz hatte.
   */
  async setPublicReplay(gameId: string, userId: string, isPublic: boolean): Promise<void> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { seats: { select: { userId: true } } },
    });
    if (!game) throw new NotFoundException(`Game ${gameId} nicht gefunden`);
    const isParticipant = game.seats.some((s) => s.userId !== null && s.userId === userId);
    if (!isParticipant) {
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (me?.role !== "ADMIN") {
        throw new ForbiddenException("Nur Teilnehmer dürfen ein Replay veröffentlichen.");
      }
    }
    await this.prisma.game.update({
      where: { id: gameId },
      data: { publicReplay: isPublic },
    });
  }

  /** Gemeinsamer Bundle-Builder für `getReplay` und `getPublicReplay`. */
  private buildBundle(game: {
    id: string;
    tableId: string | null;
    variant: GameVariant;
    ruleVersion: string;
    modelVersion: string | null;
    startedAt: Date;
    endedAt: Date | null;
    finalScore: unknown;
    publicReplay: boolean;
    seats: Array<{
      seat: number;
      userId: string | null;
      aiSeatType: string | null;
      user: { id: string; name: string } | null;
    }>;
    rounds: Array<{
      roundIdx: number;
      mode: string;
      trumpSuit: number | null;
      starter: number;
      weisen: unknown;
      slalom: boolean;
      bodenseeDeal: unknown;
    }>;
    moves: Array<{
      seq: number;
      seat: number;
      cardIndex: number;
      trickIdx: number;
      ts: Date;
      userId: string | null;
    }>;
  }): ReplayBundle {
    return {
      gameId: game.id,
      tableId: game.tableId,
      variant: game.variant,
      ruleVersion: game.ruleVersion,
      modelVersion: game.modelVersion,
      startedAt: game.startedAt.toISOString(),
      endedAt: game.endedAt?.toISOString() ?? null,
      status: game.endedAt ? "finished" : "playing",
      finalScore: game.finalScore as ReplayFinalScore | null,
      publicReplay: game.publicReplay,
      seats: game.seats.map((s) => ({
        seat: s.seat,
        userId: s.userId,
        displayName: s.user?.name ?? null,
        aiSeatType: s.aiSeatType,
      })),
      rounds: game.rounds.map((r) => ({
        roundIdx: r.roundIdx,
        mode: r.mode,
        trumpSuit: r.trumpSuit,
        starter: r.starter,
        weisen: r.weisen,
        slalom: r.slalom,
        bodenseeDeal: r.bodenseeDeal,
      })),
      moves: game.moves.map((m) => ({
        seq: m.seq,
        seat: m.seat,
        cardIndex: m.cardIndex,
        trickIdx: m.trickIdx,
        ts: m.ts.toISOString(),
        userId: m.userId,
      })),
    };
  }

  /**
   * Listet die Spiele, an denen `userId` als Sitz beteiligt war —
   * mit kompakter Meta-Info für die Profil-History (M10-B).
   * Sortiert: neuestes zuerst.
   */
  async listUserGames(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<UserGameSummary[]> {
    const seats = await this.prisma.gameSeat.findMany({
      where: { userId },
      include: {
        game: {
          include: {
            seats: {
              include: { user: { select: { id: true, name: true } } },
              orderBy: { seat: "asc" },
            },
          },
        },
      },
      orderBy: { game: { startedAt: "desc" } },
      take: limit,
      skip: offset,
    });

    return seats.map((s) => ({
      gameId: s.game.id,
      // Tisch-ID gruppiert die Einzelspiele EINER Partie (bis zum Punkteziel)
      // in der History. Null bei direkt/Test-erzeugten Spielen ohne Tisch.
      tableId: s.game.tableId,
      variant: s.game.variant,
      mySeat: s.seat,
      myTeam: s.seat % 2, // Kreuz-Jass: 0+2 vs 1+3
      startedAt: s.game.startedAt.toISOString(),
      endedAt: s.game.endedAt?.toISOString() ?? null,
      status: s.game.endedAt ? "finished" : "playing",
      finalScore: s.game.finalScore as ReplayFinalScore | null,
      seats: s.game.seats.map((seat) => ({
        seat: seat.seat,
        userId: seat.userId,
        displayName: seat.user?.name ?? null,
        aiSeatType: seat.aiSeatType,
      })),
    }));
  }
}

export interface UserGameSummary {
  gameId: string;
  /** Tisch der Partie — gruppiert Einzelspiele eines „Jass" in der History. */
  tableId: string | null;
  variant: GameVariant;
  mySeat: number;
  myTeam: number;
  startedAt: string;
  endedAt: string | null;
  status: "playing" | "finished";
  finalScore: ReplayFinalScore | null;
  seats: ReplaySeat[];
}
