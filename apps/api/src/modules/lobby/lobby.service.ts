/**
 * Tisch-Lifecycle: Öffnen, Beitreten (alle Modi), Einladen, Verlassen,
 * Owner-Wechsel, Settings ändern.
 *
 * Was hier *nicht* passiert (kommt mit den nächsten M6-Schritten):
 *   - Spielstart bei 4-voll und Karten-Verteilung (M6-C im `GameService`)
 *   - Auto-Fill nach `autoFillSeconds` (M6-D, periodischer Sweeper)
 *   - Re-Match-Voting und Starter-Berechnung (M6-E)
 *   - WS-Push für Lobby-Live-Updates (M6-F)
 *
 * Alle DB-Operationen, die mehrere Rows kreuzen (Beitritt = Sitz + Request
 * + Audit, Owner-Wechsel = LobbyTable + LobbyTableSeats), laufen in einer
 * Prisma-Transaktion, damit kein Halbzustand sichtbar wird.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  InviteStatus,
  JoinMode,
  JoinRequestStatus,
  LobbyTableStatus,
  type Prisma,
} from "@prisma/client";

import { randomBytes } from "node:crypto";

import { dealCards, type Card, type RandomFn } from "@jass/engine";

import { AuditService } from "../audit/audit.service.js";
import { BodenseeGameService } from "../game/bodensee-game.service.js";
import { GameGateway } from "../game/game.gateway.js";
import { GameService, type SeatAssignment } from "../game/game.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  InviteUserDto,
  ListTablesQuery,
  OpenTableDto,
  RematchVoteDto,
  UpdateTableSettingsDto,
} from "./lobby.dto.js";
import { LobbyGateway } from "./lobby.gateway.js";
import { LobbySettingsService } from "./lobby-settings.service.js";
import { matchStartAnnouncerSiegerGibt } from "./match-start.js";
import { SeatSwapService, type SeatSwapSnapshot, type SwapAnswer } from "./seat-swap.service.js";
import { PushService } from "../push/push.service.js";

/** Sitz-Zusammenfassung für die View. */
export interface SeatView {
  seat: number;
  user?: { id: string; name: string };
  aiSeatType?: string;
  isEmpty: boolean;
}

/** Listen-Eintrag in der Lobby-Übersicht. */
export interface TableListEntry {
  id: string;
  ownerId: string;
  ownerName: string;
  status: LobbyTableStatus;
  joinMode: JoinMode;
  /** Spielart des Tisches — z.B. "KREUZ_4P", "SOLO_4P". */
  variant: string;
  aiSeatType: string;
  autoFillSeconds: number | null;
  restartMode: "WELI" | "SIEGER_GIBT";
  /** Punkteziel der Partie (kumulativ über alle Spiele). */
  targetScore: number;
  /**
   * Kumulative Punkte je Team über alle bisher beendeten Spiele.
   * Länge 2 bei Kreuz-Jass, 4 bei Solo-Jass (ein Konto pro Spieler).
   */
  cumulativeScores: readonly number[];
  /**
   * „Im Sack" verfallene Punkte je Konto, kumuliert über die Partie. Reine
   * Info (zählen nie zur Wertung); parallel zu `cumulativeScores`.
   */
  sackedPoints: readonly number[];
  seatsTaken: number; // 1..4
  hasPendingRequest: boolean; // ist der Caller eingetragen?
  createdAt: Date;
}

/** Detail-View. Owner-spezifische Felder (joinRequests, invites) nur, wenn
 *  der Caller der Owner ist. */
export interface TableDetailView extends TableListEntry {
  seats: SeatView[];
  currentGameId: string | null;
  /** Sieg-Modus der Partie (Tisch-Einstellung). */
  winMode: "FIRST_TO_TARGET" | "HIGHEST";
  /**
   * Vom Server ermittelter Partie-Sieger-Team-Index — nur gesetzt bei
   * MATCH_OVER (sonst null). Für FIRST_TO_TARGET maßgeblich, weil sich „wer
   * zuerst" nicht aus den Endständen ableiten lässt.
   */
  matchWinner: number | null;
  joinRequests?: { id: string; userId: string; userName: string; createdAt: Date }[];
  invites?: { id: string; inviteeUserId: string; inviteeName: string; createdAt: Date }[];
  /** Laufender Sitzplatz-Tausch (ephemerer Vorspiel-Zustand), sonst null. */
  seatSwap?: SeatSwapSnapshot | null;
  /** Start-Countdown bei vollem Tisch (Spiel beginnt bei `startAt`), sonst null. */
  startCountdown?: { startAt: number } | null;
}

/** Ein aktiver Tisch in der Admin-Übersicht (Moderation / Aufräumen). */
export interface AdminTableView {
  id: string;
  ownerId: string;
  ownerName: string;
  status: LobbyTableStatus;
  variant: string;
  createdAt: string; // ISO
  humanCount: number;
  aiCount: number;
  humanNames: string[];
  /** Sitzt der Owner selbst? Wenn nein = „hängengebliebener"/verwaister Tisch. */
  ownerSeated: boolean;
}

/** Offene Einladung AN den eingeloggten User — für die bleibende Lobby-Liste
 *  „Du wurdest eingeladen" (Empfänger-Sicht, anders als die Owner-Invites oben). */
export interface IncomingInviteView {
  inviteId: string;
  tableId: string;
  variant: TableListEntry["variant"];
  inviterName: string;
  createdAt: string;
}

@Injectable()
export class LobbyService {
  private readonly log = new Logger(LobbyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly games: GameService,
    private readonly bodenseeGames: BodenseeGameService,
    // Bodensee-KI nach freiwilligem Verlassen antreiben (Broadcast + AI-Loop
    // liegen im Game-Gateway). game-Modul hängt NICHT von lobby ab → kein Zyklus.
    private readonly gameGateway: GameGateway,
    private readonly gateway: LobbyGateway,
    private readonly settings: LobbySettingsService,
    private readonly push: PushService,
    private readonly seatSwap: SeatSwapService
  ) {
    // Einbahn-Abhängigkeit (kein forwardRef/Import-Zyklus, der sonst im
    // Prod-ESM-Build crasht): wir injizieren den SeatSwapService und
    // registrieren uns als seinen Host für die DB-Callbacks.
    this.seatSwap.bindHost(this);
  }

  /**
   * Pusht den aktuellen Tisch-State über das Gateway. Wird nach jeder
   * Mutation aufgerufen. Bei nicht-existierendem Tisch ist das ein no-op.
   *
   * Wir laden die Detail-View mit `system` als Caller — der Push geht an
   * alle Tisch-Abonnenten, und die Detail-View ist genau so granular, wie
   * die Subscriber das brauchen. (Owner-spezifische Felder wie
   * `joinRequests`/`invites` sind in der View enthalten, weil die View
   * `callerId === ownerId` prüft. Hier liefern wir die *generische* View
   * ohne Owner-Felder; Owner refetchen explizit per REST, wenn sie diese
   * Detail-Daten brauchen.)
   */
  async pushTableState(tableId: string): Promise<void> {
    try {
      // `__system__` als callerId → kein Match auf ownerId, also Owner-
      // Felder nicht im Payload. Das ist der sichere Default für Broadcasts.
      const view = await this.getTableView(tableId, "__system__");
      this.gateway.broadcastTableState(tableId, view);
    } catch {
      // Tisch existiert nicht mehr oder anderer Fehler — Push schweigt.
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Tisch öffnen
  // ───────────────────────────────────────────────────────────────────

  async openTable(ownerId: string, dto: OpenTableDto): Promise<{ tableId: string }> {
    // Globale Einstellungen (Admin) laden — fließen in drei Stellen:
    //   1. Hard-Cap auf gleichzeitig aktive Tische
    //   2. Hard-Cap auf Sitzzahl pro Variante (heute kosmetisch, weil
    //      alle existierenden Varianten ≤ 6 Sitze haben)
    //   3. Fallback für `targetScore`, falls der Eröffner keinen mitschickt
    const settings = await this.settings.getAll();

    const seatCount = seatCountForVariant(dto.variant);
    if (seatCount > settings.maxSeatsPerTable) {
      throw new BadRequestException(
        `Variante ${dto.variant} hat ${seatCount} Sitze, der Admin-Cap liegt bei ${settings.maxSeatsPerTable}.`
      );
    }

    const openCount = await this.prisma.lobbyTable.count({
      where: {
        status: {
          in: [LobbyTableStatus.WAITING, LobbyTableStatus.IN_GAME, LobbyTableStatus.POST_GAME],
        },
      },
    });
    if (openCount >= settings.maxOpenTables) {
      throw new ConflictException(
        `Maximale Anzahl gleichzeitig aktiver Tische erreicht (${settings.maxOpenTables}). ` +
          `Bitte warte, bis ein Tisch fertig wird, oder kontaktiere einen Admin.`
      );
    }

    // Owner darf NICHT zwei aktive Tische gleichzeitig besitzen. Das schließt
    // Edge-Cases im Auto-Fill aus (welcher Tisch bekommt das nächste Spiel?).
    const existingOwned = await this.prisma.lobbyTable.findFirst({
      where: {
        ownerId,
        status: {
          in: [LobbyTableStatus.WAITING, LobbyTableStatus.IN_GAME, LobbyTableStatus.POST_GAME],
        },
      },
      select: { id: true },
    });
    if (existingOwned) {
      throw new ConflictException({
        message: "Du besitzt bereits einen aktiven Tisch.",
        existingTableId: existingOwned.id,
      });
    }

    const effectiveTargetScore = dto.targetScore ?? settings.defaultPointsTarget;

    const table = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lobbyTable.create({
        data: {
          ownerId,
          joinMode: dto.joinMode,
          variant: dto.variant,
          announceLevel: dto.announceLevel,
          allowGumpf: dto.allowGumpf,
          sackRule: dto.sackRule,
          weisNeedsTrick: dto.weisNeedsTrick,
          cutEnabled: dto.cutEnabled,
          aiSeatType: dto.aiSeatType,
          autoFillSeconds: dto.autoFillSeconds,
          restartMode: dto.restartMode,
          targetScore: effectiveTargetScore,
          // undefined → Prisma nimmt den Schema-Default (FIRST_TO_TARGET).
          ...(dto.winMode !== undefined ? { winMode: dto.winMode } : {}),
          status: LobbyTableStatus.WAITING,
        },
      });

      // Sitz 0 = Owner
      await tx.lobbyTableSeat.create({
        data: {
          tableId: created.id,
          seat: 0,
          userId: ownerId,
          joinOrder: 0,
        },
      });

      // Optional vorbelegte KI-Sitze.
      for (const ai of dto.initialAiSeats) {
        await tx.lobbyTableSeat.create({
          data: {
            tableId: created.id,
            seat: ai.seat,
            aiSeatType: ai.aiSeatType ?? dto.aiSeatType,
            // joinOrder bei KIs ist für Owner-Wechsel irrelevant, aber
            // numerisch sortierbar — wir halten sie hoch (>10), damit nie
            // eine KI „nachrückt".
            joinOrder: 100 + ai.seat,
          },
        });
      }

      return created;
    });

    await this.audit.record({
      action: "lobby.table.open",
      actorId: ownerId,
      target: table.id,
      meta: {
        joinMode: dto.joinMode,
        aiSeatType: dto.aiSeatType,
        initialAiSeats: dto.initialAiSeats.length,
      },
    });
    this.log.log({ tableId: table.id, ownerId }, "Tisch geöffnet");

    // Wenn der Owner direkt mit 3 KIs öffnet, ist der Tisch sofort voll
    // und startet automatisch.
    await this.tryAutoStartGame(table.id);

    // M6-F: Lobby-Liste-Abonnenten informieren, Tisch-State pushen.
    this.gateway.broadcastLobbyListUpdate("table-opened", table.id);
    await this.pushTableState(table.id);
    return { tableId: table.id };
  }

  // ───────────────────────────────────────────────────────────────────
  // Lobby-Listing
  // ───────────────────────────────────────────────────────────────────

  async listTables(callerId: string, query: ListTablesQuery): Promise<TableListEntry[]> {
    const statusFilter = query.status
      ? Array.isArray(query.status)
        ? query.status
        : [query.status]
      : ([LobbyTableStatus.WAITING, LobbyTableStatus.POST_GAME] as LobbyTableStatus[]);

    const where: Prisma.LobbyTableWhereInput = {
      status: { in: statusFilter },
    };
    if (query.joinMode) where.joinMode = query.joinMode;
    if (query.mine) {
      where.OR = [{ ownerId: callerId }, { seats: { some: { userId: callerId } } }];
    }

    const tables = await this.prisma.lobbyTable.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true } },
        seats: { select: { seat: true, userId: true } },
        joinRequests: {
          where: { userId: callerId, status: JoinRequestStatus.PENDING },
          select: { id: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100, // sicheres Limit; Pagination bei Bedarf später
    });

    return tables.map((t) => ({
      id: t.id,
      ownerId: t.ownerId,
      ownerName: t.owner.name,
      status: t.status,
      joinMode: t.joinMode,
      variant: t.variant,
      aiSeatType: t.aiSeatType,
      autoFillSeconds: t.autoFillSeconds,
      restartMode: t.restartMode as "WELI" | "SIEGER_GIBT",
      targetScore: t.targetScore,
      cumulativeScores: buildCumulativeScores(t),
      sackedPoints: buildSackedPoints(t),
      seatsTaken: t.seats.length,
      hasPendingRequest: t.joinRequests.length > 0,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Tische, an denen der User aktuell beteiligt ist (Owner ODER Sitz-
   * Inhaber) und die nicht CLOSED sind. Für die „Mein aktiver Tisch"-
   * Karte in der Lobby — damit der User nach Navigation zurückfindet.
   *
   * Im Gegensatz zu `listTables` ignorieren wir hier `joinMode` (Owner
   * darf seinen INVITE-Tisch immer sehen) und das Status-Default-Filter
   * (POST_GAME-Tische gehören auch dazu).
   */
  async listMyTables(callerId: string): Promise<TableListEntry[]> {
    const tables = await this.prisma.lobbyTable.findMany({
      where: {
        status: { not: LobbyTableStatus.CLOSED },
        OR: [{ ownerId: callerId }, { seats: { some: { userId: callerId } } }],
      },
      include: {
        owner: { select: { id: true, name: true } },
        seats: { select: { seat: true, userId: true } },
        joinRequests: {
          where: { userId: callerId, status: JoinRequestStatus.PENDING },
          select: { id: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return tables.map((t) => ({
      id: t.id,
      ownerId: t.ownerId,
      ownerName: t.owner.name,
      status: t.status,
      joinMode: t.joinMode,
      variant: t.variant,
      aiSeatType: t.aiSeatType,
      autoFillSeconds: t.autoFillSeconds,
      restartMode: t.restartMode as "WELI" | "SIEGER_GIBT",
      targetScore: t.targetScore,
      cumulativeScores: buildCumulativeScores(t),
      sackedPoints: buildSackedPoints(t),
      seatsTaken: t.seats.length,
      hasPendingRequest: t.joinRequests.length > 0,
      createdAt: t.createdAt,
    }));
  }

  // ───────────────────────────────────────────────────────────────────
  // Tisch-Detail
  // ───────────────────────────────────────────────────────────────────

  async getTableView(tableId: string, callerId: string): Promise<TableDetailView> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: {
        owner: { select: { id: true, name: true } },
        seats: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { seat: "asc" },
        },
        joinRequests: {
          where: { status: JoinRequestStatus.PENDING },
          include: { user: { select: { id: true, name: true } } },
        },
        invites: {
          where: { status: InviteStatus.PENDING },
          include: { invitee: { select: { id: true, name: true } } },
        },
      },
    });
    if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);

    // Sitz-Layout je Spielart: leere Sitze als Platzhalter zeigen, damit die
    // UI alle Plätze rendern kann (4 bei Kreuz/Solo, 2 bei Bodensee).
    const seatsByIndex = new Map(table.seats.map((s) => [s.seat, s]));
    const seats: SeatView[] = [];
    for (let i = 0; i < seatCountForVariant(table.variant); i++) {
      const s = seatsByIndex.get(i);
      if (!s) {
        seats.push({ seat: i, isEmpty: true });
        continue;
      }
      seats.push({
        seat: i,
        ...(s.user ? { user: { id: s.user.id, name: s.user.name } } : {}),
        ...(s.aiSeatType ? { aiSeatType: s.aiSeatType } : {}),
        isEmpty: false,
      });
    }

    const isOwner = table.ownerId === callerId;
    const callerHasPendingRequest = await this.prisma.gameJoinRequest.count({
      where: { tableId, userId: callerId, status: JoinRequestStatus.PENDING },
    });

    const view: TableDetailView = {
      id: table.id,
      ownerId: table.ownerId,
      ownerName: table.owner.name,
      status: table.status,
      joinMode: table.joinMode,
      variant: table.variant,
      aiSeatType: table.aiSeatType,
      autoFillSeconds: table.autoFillSeconds,
      restartMode: table.restartMode as "WELI" | "SIEGER_GIBT",
      targetScore: table.targetScore,
      cumulativeScores: buildCumulativeScores(table),
      sackedPoints: buildSackedPoints(table),
      seatsTaken: table.seats.length,
      hasPendingRequest: callerHasPendingRequest > 0,
      createdAt: table.createdAt,
      seats,
      currentGameId: table.currentGameId,
      winMode: table.winMode,
      matchWinner: table.matchWinnerTeam,
    };
    if (isOwner) {
      view.joinRequests = table.joinRequests.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.user.name,
        createdAt: r.createdAt,
      }));
      view.invites = table.invites.map((i) => ({
        id: i.id,
        inviteeUserId: i.inviteeUserId,
        inviteeName: i.invitee.name,
        createdAt: i.createdAt,
      }));
    }
    // Ephemerer Vorspiel-Zustand (in-memory): laufender Tausch + Start-Countdown.
    view.seatSwap = this.seatSwap.snapshot(tableId);
    view.startCountdown = this.seatSwap.startCountdownSnapshot(tableId);
    return view;
  }

  // ───────────────────────────────────────────────────────────────────
  // Beitritt
  // ───────────────────────────────────────────────────────────────────

  /**
   * Sitz-Vergabe je nach joinMode. Returnt entweder den vergebenen Sitz
   * (sofort beigetreten) oder den Request/Invite-Status (pending).
   */
  async joinTable(
    tableId: string,
    userId: string
  ): Promise<
    | { kind: "seated"; seat: number }
    | { kind: "request-pending"; requestId: string }
    | { kind: "invite-used"; seat: number }
  > {
    const table = await this.requireOpenTable(tableId);
    await this.requireNotAlreadySeated(tableId, userId);
    await this.requireNotBanned(tableId, userId);

    // INVITE-Modus: Nur wenn der Caller eine PENDING-Invite hat → Invite
    // wird auto-akzeptiert und ein Sitz vergeben.
    if (table.joinMode === JoinMode.INVITE) {
      const invite = await this.prisma.tableInvite.findFirst({
        where: { tableId, inviteeUserId: userId, status: InviteStatus.PENDING },
      });
      if (!invite) {
        throw new ForbiddenException(
          "Dieser Tisch ist nur per Einladung beitretbar — du hast keine offene Einladung."
        );
      }
      const seat = await this.prisma.$transaction((tx) =>
        this.assignSeatAndCloseInvite(tx, table.id, userId, invite.id)
      );
      await this.audit.record({
        action: "lobby.table.join.via_invite",
        actorId: userId,
        target: table.id,
        meta: { seat, inviteId: invite.id },
      });
      await this.tryAutoStartGame(table.id);
      this.gateway.broadcastLobbyListUpdate("seat-changed", table.id);
      await this.pushTableState(table.id);
      return { kind: "invite-used", seat };
    }

    // REQUEST-Modus: Request anlegen statt Sitz zu geben.
    if (table.joinMode === JoinMode.REQUEST) {
      // Wenn der User schon eine offene Invite hat (Owner kann auch beim
      // REQUEST-Tisch einladen), behandeln wir das wie INVITE-Auto-Akzept.
      const invite = await this.prisma.tableInvite.findFirst({
        where: { tableId, inviteeUserId: userId, status: InviteStatus.PENDING },
      });
      if (invite) {
        const seat = await this.prisma.$transaction((tx) =>
          this.assignSeatAndCloseInvite(tx, table.id, userId, invite.id)
        );
        await this.tryAutoStartGame(table.id);
        this.gateway.broadcastLobbyListUpdate("seat-changed", table.id);
        await this.pushTableState(table.id);
        return { kind: "invite-used", seat };
      }
      const request = await this.prisma.gameJoinRequest.create({
        data: { tableId, userId, status: JoinRequestStatus.PENDING },
      });
      await this.audit.record({
        action: "lobby.join.request",
        actorId: userId,
        target: table.id,
        meta: { requestId: request.id },
      });
      // Owner-Push: neuer Beitritts-Wunsch landet im Owner's UI.
      const tableOwner = await this.prisma.lobbyTable.findUnique({
        where: { id: tableId },
        select: { ownerId: true },
      });
      if (tableOwner) {
        const requesterName = await this.prisma.user
          .findUnique({ where: { id: userId }, select: { name: true } })
          .then((u) => u?.name ?? "?");
        this.gateway.pushToUser(tableOwner.ownerId, "lobby:join-request-incoming", {
          tableId,
          requestId: request.id,
          userId,
          userName: requesterName,
        });
        // Zusätzlich Web-Push — funktioniert auch, wenn der Owner gerade
        // keinen Tab offen hat. Fail-open: hängt am `push.sendToUser` selbst,
        // wir reichen den Aufruf nur an.
        void this.push.sendToUser(tableOwner.ownerId, {
          title: "Neue Beitritts-Anfrage",
          body: `${requesterName} möchte an deinem Tisch mitspielen.`,
          url: `/lobby/${tableId}`,
          tag: `join-request-${tableId}`,
        });
      }
      await this.pushTableState(table.id);
      return { kind: "request-pending", requestId: request.id };
    }

    // OPEN: sofort beitreten.
    const seat = await this.prisma.$transaction((tx) => this.assignNextSeat(tx, table.id, userId));
    await this.audit.record({
      action: "lobby.table.join",
      actorId: userId,
      target: table.id,
      meta: { seat },
    });
    await this.tryAutoStartGame(table.id);
    this.gateway.broadcastLobbyListUpdate("seat-changed", table.id);
    await this.pushTableState(table.id);
    return { kind: "seated", seat };
  }

  /** Beitritts-Anfrage zurückziehen (vom Anfragenden selbst). */
  async cancelJoinRequest(tableId: string, userId: string): Promise<void> {
    const updated = await this.prisma.gameJoinRequest.updateMany({
      where: { tableId, userId, status: JoinRequestStatus.PENDING },
      data: { status: JoinRequestStatus.CANCELLED, decidedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException("Keine offene Beitritts-Anfrage gefunden.");
    }
    await this.audit.record({
      action: "lobby.join.request.cancel",
      actorId: userId,
      target: tableId,
    });
    await this.pushTableState(tableId);
  }

  async approveJoinRequest(
    tableId: string,
    requestId: string,
    ownerId: string
  ): Promise<{ seat: number }> {
    const table = await this.requireOwner(tableId, ownerId);
    if (table.status !== LobbyTableStatus.WAITING && table.status !== LobbyTableStatus.POST_GAME) {
      throw new ConflictException("Tisch nimmt aktuell keine neuen Spieler an.");
    }

    return this.prisma
      .$transaction(async (tx) => {
        const request = await tx.gameJoinRequest.findUnique({ where: { id: requestId } });
        if (!request || request.tableId !== tableId) {
          throw new NotFoundException("Anfrage nicht gefunden.");
        }
        if (request.status !== JoinRequestStatus.PENDING) {
          throw new ConflictException(`Anfrage hat bereits Status ${request.status}.`);
        }
        await this.requireNotBanned(tableId, request.userId);
        // Sitz für den Anfragenden vergeben.
        const seat = await this.assignNextSeat(tx, tableId, request.userId);
        await tx.gameJoinRequest.update({
          where: { id: requestId },
          data: { status: JoinRequestStatus.APPROVED, decidedAt: new Date() },
        });
        await this.audit.record({
          action: "lobby.join.request.approve",
          actorId: ownerId,
          target: tableId,
          meta: { requestId, userId: request.userId, seat },
        });
        return { seat, requesterId: request.userId };
      })
      .then(async ({ seat, requesterId }) => {
        // Auto-Start außerhalb der Transaktion: der GameService öffnet seine
        // eigene Transaktion und das nesten würde unnötig blockieren.
        await this.tryAutoStartGame(tableId);
        // M6-F: Requester wird benachrichtigt, Tisch-State broadcasten.
        this.gateway.pushToUser(requesterId, "lobby:request-decided", {
          tableId,
          requestId,
          approved: true,
          seat,
        });
        this.gateway.broadcastLobbyListUpdate("seat-changed", tableId);
        await this.pushTableState(tableId);
        return { seat };
      });
  }

  async denyJoinRequest(tableId: string, requestId: string, ownerId: string): Promise<void> {
    await this.requireOwner(tableId, ownerId);
    const request = await this.prisma.gameJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.tableId !== tableId) {
      throw new NotFoundException("Anfrage nicht gefunden.");
    }
    if (request.status !== JoinRequestStatus.PENDING) {
      throw new ConflictException(`Anfrage hat bereits Status ${request.status}.`);
    }
    await this.prisma.gameJoinRequest.update({
      where: { id: requestId },
      data: { status: JoinRequestStatus.DENIED, decidedAt: new Date() },
    });
    await this.audit.record({
      action: "lobby.join.request.deny",
      actorId: ownerId,
      target: tableId,
      meta: { requestId, userId: request.userId },
    });
    // Requester benachrichtigen, Tisch-State (Owner sieht in seinem View
    // weniger pending Requests).
    this.gateway.pushToUser(request.userId, "lobby:request-decided", {
      tableId,
      requestId,
      approved: false,
    });
    await this.pushTableState(tableId);
  }

  // ───────────────────────────────────────────────────────────────────
  // Einladungen
  // ───────────────────────────────────────────────────────────────────

  async inviteUser(
    tableId: string,
    ownerId: string,
    dto: InviteUserDto
  ): Promise<{ inviteId: string; inviteeUserId: string }> {
    const table = await this.requireOwner(tableId, ownerId);
    if (table.status === LobbyTableStatus.CLOSED) {
      throw new ConflictException("Tisch ist geschlossen.");
    }

    const invitee = await this.resolveInvitee(dto);
    if (invitee.id === ownerId) {
      throw new BadRequestException("Du kannst dich nicht selbst einladen.");
    }
    // Schon eingeladen? Schon am Tisch? Verhindern.
    const seated = await this.prisma.lobbyTableSeat.findFirst({
      where: { tableId, userId: invitee.id },
    });
    if (seated) {
      throw new ConflictException("Spieler sitzt bereits am Tisch.");
    }
    const existingInvite = await this.prisma.tableInvite.findUnique({
      where: { tableId_inviteeUserId: { tableId, inviteeUserId: invitee.id } },
    });
    if (existingInvite && existingInvite.status === InviteStatus.PENDING) {
      throw new ConflictException("Es liegt bereits eine offene Einladung vor.");
    }

    // Bei vorheriger DECLINED/CANCELLED-Invite ersetzen wir den Eintrag,
    // damit die @@unique([tableId, inviteeUserId])-Regel nicht greift.
    const invite = existingInvite
      ? await this.prisma.tableInvite.update({
          where: { id: existingInvite.id },
          data: {
            status: InviteStatus.PENDING,
            invitedByUserId: ownerId,
            createdAt: new Date(),
            respondedAt: null,
          },
        })
      : await this.prisma.tableInvite.create({
          data: { tableId, inviteeUserId: invitee.id, invitedByUserId: ownerId },
        });

    await this.audit.record({
      action: "lobby.invite",
      actorId: ownerId,
      target: tableId,
      meta: { inviteId: invite.id, inviteeUserId: invitee.id },
    });
    // Einladung an den Eingeladenen pushen.
    this.gateway.pushToUser(invitee.id, "lobby:invite-received", {
      inviteId: invite.id,
      tableId,
      inviterId: ownerId,
    });
    await this.pushTableState(tableId);
    return { inviteId: invite.id, inviteeUserId: invitee.id };
  }

  async acceptInvite(inviteId: string, userId: string): Promise<{ seat: number }> {
    const invite = await this.prisma.tableInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.inviteeUserId !== userId) {
      throw new NotFoundException("Einladung nicht gefunden.");
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new ConflictException(`Einladung hat Status ${invite.status}.`);
    }
    const table = await this.requireOpenTable(invite.tableId);
    await this.requireNotAlreadySeated(invite.tableId, userId);
    await this.requireNotBanned(invite.tableId, userId);

    const seat = await this.prisma.$transaction((tx) =>
      this.assignSeatAndCloseInvite(tx, table.id, userId, invite.id)
    );
    await this.audit.record({
      action: "lobby.invite.accept",
      actorId: userId,
      target: invite.tableId,
      meta: { inviteId, seat },
    });
    await this.tryAutoStartGame(table.id);
    this.gateway.broadcastLobbyListUpdate("seat-changed", table.id);
    await this.pushTableState(table.id);
    return { seat };
  }

  async declineInvite(inviteId: string, userId: string): Promise<void> {
    const invite = await this.prisma.tableInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.inviteeUserId !== userId) {
      throw new NotFoundException("Einladung nicht gefunden.");
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new ConflictException(`Einladung hat Status ${invite.status}.`);
    }
    await this.prisma.tableInvite.update({
      where: { id: inviteId },
      data: { status: InviteStatus.DECLINED, respondedAt: new Date() },
    });
    await this.audit.record({
      action: "lobby.invite.decline",
      actorId: userId,
      target: invite.tableId,
      meta: { inviteId },
    });
    await this.pushTableState(invite.tableId);
  }

  /**
   * Offene (PENDING) Einladungen, die AN `userId` gerichtet sind — für die
   * bleibende Lobby-Liste „Du wurdest eingeladen". Geschlossene Tische werden
   * ausgefiltert (dort kann man eh nicht mehr beitreten).
   */
  async listIncomingInvites(userId: string): Promise<IncomingInviteView[]> {
    const invites = await this.prisma.tableInvite.findMany({
      where: { inviteeUserId: userId, status: InviteStatus.PENDING },
      include: {
        table: { select: { variant: true, status: true } },
        invitedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return invites
      .filter((i) => i.table.status !== LobbyTableStatus.CLOSED)
      .map((i) => ({
        inviteId: i.id,
        tableId: i.tableId,
        variant: i.table.variant,
        inviterName: i.invitedBy.name,
        createdAt: i.createdAt.toISOString(),
      }));
  }

  async cancelInvite(tableId: string, inviteId: string, ownerId: string): Promise<void> {
    await this.requireOwner(tableId, ownerId);
    const invite = await this.prisma.tableInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.tableId !== tableId) {
      throw new NotFoundException("Einladung nicht gefunden.");
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new ConflictException(`Einladung hat Status ${invite.status}.`);
    }
    await this.prisma.tableInvite.update({
      where: { id: inviteId },
      data: { status: InviteStatus.CANCELLED, respondedAt: new Date() },
    });
    await this.audit.record({
      action: "lobby.invite.cancel",
      actorId: ownerId,
      target: tableId,
      meta: { inviteId },
    });
    // Eingeladenen informieren, falls er gerade die Einladung im UI sieht.
    this.gateway.pushToUser(invite.inviteeUserId, "lobby:invite-cancelled", {
      inviteId,
      tableId,
    });
    await this.pushTableState(tableId);
  }

  // ───────────────────────────────────────────────────────────────────
  // Settings ändern
  // ───────────────────────────────────────────────────────────────────

  async updateSettings(
    tableId: string,
    ownerId: string,
    dto: UpdateTableSettingsDto
  ): Promise<void> {
    const table = await this.requireOwner(tableId, ownerId);
    if (table.status !== LobbyTableStatus.WAITING) {
      throw new ConflictException("Settings können nur in der WAITING-Phase geändert werden.");
    }
    const data: Prisma.LobbyTableUpdateInput = {};
    if (dto.joinMode !== undefined) data.joinMode = dto.joinMode;
    if (dto.aiSeatType !== undefined) data.aiSeatType = dto.aiSeatType;
    if (dto.autoFillSeconds !== undefined) data.autoFillSeconds = dto.autoFillSeconds;
    if (dto.restartMode !== undefined) data.restartMode = dto.restartMode;
    if (dto.targetScore !== undefined) data.targetScore = dto.targetScore;
    await this.prisma.lobbyTable.update({ where: { id: tableId }, data });
    await this.audit.record({
      action: "lobby.table.settings.update",
      actorId: ownerId,
      target: tableId,
      // Settings-Patch zu JSON-Object verflachen (InputJsonValue verlangt
      // konkrete Felder, kein Record-Typ).
      meta: {
        ...(dto.joinMode !== undefined ? { joinMode: dto.joinMode } : {}),
        ...(dto.aiSeatType !== undefined ? { aiSeatType: dto.aiSeatType } : {}),
        ...(dto.autoFillSeconds !== undefined ? { autoFillSeconds: dto.autoFillSeconds } : {}),
        ...(dto.restartMode !== undefined ? { restartMode: dto.restartMode } : {}),
        ...(dto.targetScore !== undefined ? { targetScore: dto.targetScore } : {}),
      },
    });
    this.gateway.broadcastLobbyListUpdate("settings-changed", tableId);
    await this.pushTableState(tableId);
  }

  // ───────────────────────────────────────────────────────────────────
  // Verlassen / Owner-Wechsel / Tisch-Schließung
  // ───────────────────────────────────────────────────────────────────

  /**
   * Spieler verlässt den Tisch. Drei Pfade:
   *   1. Caller ist KEIN Owner → Sitz freigeben, Tisch bleibt.
   *   2. Caller ist Owner UND es gibt weitere menschliche Sitze → Owner
   *      wechselt zum Spieler mit dem niedrigsten `joinOrder` unter den
   *      Verbleibenden (User-Entscheidung 5: „erster nach dem Owner").
   *   3. Caller ist Owner UND er ist der letzte Mensch → Tisch schließen
   *      (Status = CLOSED). KI-Sitze allein werden nicht weitergespielt.
   *
   * Returnt einen Diff-Bericht, damit M6-F den Lobby-Broadcast über genau
   * die richtigen Änderungen feuern kann.
   */
  async leaveTable(
    tableId: string,
    userId: string
  ): Promise<{
    seatFreed: number | null;
    newOwnerId: string | null;
    tableClosed: boolean;
  }> {
    // Pending-Requesters VOR der Transaktion einsammeln — die brauchen wir
    // nur für den Owner-Wechsel-Push (User-Entscheidung 2 aus der
    // M6-Vorschau: bei Owner-Wechsel kriegen alle pending-Requesters einen
    // Hinweis). Die Liste kann zwischen Snapshot und Transaktion theoretisch
    // veralten — das ist eine reine UI-Notifikation und tolerierbar.
    const pendingRequesters = await this.prisma.gameJoinRequest.findMany({
      where: { tableId, status: JoinRequestStatus.PENDING },
      select: { userId: true },
    });

    // Wenn das Spiel gerade läuft (IN_GAME / POST_GAME), läuft das Verlassen
    // anders: der GameSeat wird nicht gelöscht, sondern als ausgestiegen
    // markiert und durch eine KI ersetzt. So sehen Mitspieler das Spiel
    // weiterlaufen — und im Audit-Log steht „User X hat in einer Partie
    // mit echten Mitspielern aufgegeben".
    const tablePre = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: {
        status: true,
        ownerId: true,
        currentGameId: true,
        aiSeatType: true,
        variant: true,
      },
    });
    if (!tablePre) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
    if (tablePre.status === LobbyTableStatus.CLOSED) {
      throw new ConflictException("Tisch ist bereits geschlossen.");
    }
    if (
      (tablePre.status === LobbyTableStatus.IN_GAME ||
        tablePre.status === LobbyTableStatus.POST_GAME) &&
      tablePre.currentGameId !== null
    ) {
      const aiType = tablePre.aiSeatType ?? "heuristic";
      const isBodensee = tablePre.variant === "BODENSEE_2P";

      // Sitz auf KI umstellen. Kreuz/Solo: markUserLeft (loggt intern den
      // „game.abandoned"-Audit + treibt unten bei 0 Menschen zu Ende).
      // Bodensee läuft über den eigenen Service: replaceSeatWithAi (Sitz +
      // Audit), der KI-Antrieb passiert weiter unten über das Game-Gateway.
      if (isBodensee) {
        await this.bodenseeGames.replaceSeatWithAi(tablePre.currentGameId, userId);
      } else {
        await this.games.markUserLeft(tablePre.currentGameId, userId, aiType);
      }

      // Lobby-Sitz auf KI umschalten.
      const seatRow = await this.prisma.lobbyTableSeat.findFirst({
        where: { tableId, userId },
      });
      if (seatRow) {
        await this.prisma.lobbyTableSeat.update({
          where: { tableId_seat: { tableId, seat: seatRow.seat } },
          data: { userId: null, aiSeatType: aiType },
        });
      }
      await this.audit.record({
        action: "lobby.table.leave.ingame",
        actorId: userId,
        target: tableId,
        meta: { seat: seatRow?.seat ?? null },
      });

      // Owner-Wechsel, falls der ausgestiegene User Owner war und es
      // noch andere menschliche Sitze gibt. „Erster nach joinOrder"
      // unter den verbleibenden Menschen wird neuer Owner.
      let newOwnerId: string | null = null;
      if (tablePre.ownerId === userId) {
        const otherHumans = await this.prisma.lobbyTableSeat.findMany({
          where: { tableId, userId: { not: null } },
          orderBy: { joinOrder: "asc" },
        });
        if (otherHumans.length > 0 && otherHumans[0]?.userId) {
          newOwnerId = otherHumans[0].userId;
          await this.prisma.lobbyTable.update({
            where: { id: tableId },
            data: { ownerId: newOwnerId },
          });
          await this.audit.record({
            action: "lobby.table.owner.change",
            actorId: userId,
            target: tableId,
            meta: { from: userId, to: newOwnerId, reason: "abandoned" },
          });
        }
      }

      // Wenn nach dem Aussteig kein Mensch mehr am Tisch ist: Spiel
      // server-seitig zu Ende treiben (sonst hängt es endlos, weil kein
      // game:move/game:announce vom Client triggert), dann Tisch CLOSED.
      const remainingHumanCount = await this.prisma.lobbyTableSeat.count({
        where: { tableId, userId: { not: null } },
      });

      // Bodensee: „game.abandoned" separat loggen (bei Kreuz/Solo macht das
      // markUserLeft intern) → Bodensee-Aussteiger erscheinen in der
      // Quitter-Statistik. hadHumanOpponents = es war noch ein Mensch am Tisch.
      // Verbleibt ein Mensch, lässt das Game-Gateway die KI MIT Broadcasts
      // weiterspielen (fire-and-forget: KI-Loop hat UI-Delays, darf die
      // Leave-Antwort nicht blockieren — Fehler werden im Gateway geloggt).
      if (isBodensee) {
        await this.audit.record({
          action: "game.abandoned",
          actorId: userId,
          target: tablePre.currentGameId,
          meta: {
            seat: seatRow?.seat ?? null,
            hadHumanOpponents: remainingHumanCount > 0,
            variant: "BODENSEE_2P",
          },
        });
        if (remainingHumanCount > 0) {
          // Name des Aussteigers fürs Dialog-Wording beim Verbliebenen
          // („Der Spieler X hat den Tisch verlassen …"). Der GameSeat ist
          // schon auf KI umgestellt, der User-Datensatz aber unberührt.
          const leaver = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });
          void this.gameGateway.driveBodenseeAfterLeave(
            tablePre.currentGameId,
            leaver?.name ?? null
          );
        }
      }

      let tableClosed = false;
      if (remainingHumanCount === 0) {
        // Kreuz/Solo headless zu Ende treiben. Bei Bodensee NICHT — eigener
        // Service, und bei 0 Menschen wird der Tisch sowieso gleich geschlossen.
        if (tablePre.status === LobbyTableStatus.IN_GAME && !isBodensee) {
          // Robust: ein Fehler beim KI-Fertigspielen darf das Schließen NICHT
          // verhindern — sonst bleibt der Tisch als Waise (Owner nicht gesetzt,
          // nur KI) zurück, den niemand mehr schließen kann.
          try {
            await this.games.driveAIsToEnd(tablePre.currentGameId);
          } catch (err) {
            this.log.warn(
              { tableId, gameId: tablePre.currentGameId, err },
              "driveAIsToEnd fehlgeschlagen — schließe Tisch trotzdem"
            );
          }
        }
        await this.prisma.lobbyTable.update({
          where: { id: tableId },
          data: { status: LobbyTableStatus.CLOSED, closedAt: new Date() },
        });
        tableClosed = true;
        this.log.log(
          { tableId, gameId: tablePre.currentGameId },
          "Tisch geschlossen — keine Menschen mehr am Tisch nach Aussteig"
        );
      }

      this.gateway.broadcastLobbyListUpdate(tableClosed ? "closed" : "ingame-abandon", tableId);
      await this.pushTableState(tableId);
      return {
        seatFreed: seatRow?.seat ?? null,
        newOwnerId,
        tableClosed,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const table = await tx.lobbyTable.findUnique({
        where: { id: tableId },
        include: { seats: { orderBy: { joinOrder: "asc" } } },
      });
      if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
      if (table.status === LobbyTableStatus.CLOSED) {
        throw new ConflictException("Tisch ist bereits geschlossen.");
      }
      // Verlassen in IN_GAME/POST_GAME wird oben behandelt (Sitz-auf-KI-
      // Umschaltung). Hier landen WAITING und MATCH_OVER: in beiden gibt es
      // kein laufendes Spiel mehr → Sitz wird einfach freigegeben, und wenn
      // der letzte Mensch geht, wird der Tisch geschlossen. (MATCH_OVER bleibt
      // sonst offen, damit der Owner „Neue Partie" starten kann — verlässt er
      // aber, muss er sauber zugehen, sonst verwaist der Tisch dauerhaft.)
      if (
        table.status !== LobbyTableStatus.WAITING &&
        table.status !== LobbyTableStatus.MATCH_OVER
      ) {
        throw new ConflictException("Unerwarteter Tisch-Status für Leave-Pfad.");
      }

      const mySeat = table.seats.find((s) => s.userId === userId);
      if (!mySeat) throw new NotFoundException("Du sitzt nicht an diesem Tisch.");

      // Sitz freigeben (LobbyTableSeat löschen) + Timer-Reset (M6-D).
      await tx.lobbyTableSeat.delete({
        where: { tableId_seat: { tableId, seat: mySeat.seat } },
      });
      await tx.lobbyTable.update({
        where: { id: tableId },
        data: { lastSeatChangeAt: new Date() },
      });

      // Verbleibende menschliche Sitze (KI-Sitze rücken nicht als Owner nach).
      const remainingHumans = table.seats.filter((s) => s.userId !== null && s.userId !== userId);

      // Fall A: caller ist nicht Owner → Tisch lebt weiter.
      if (table.ownerId !== userId) {
        await this.audit.record({
          action: "lobby.table.leave",
          actorId: userId,
          target: tableId,
          meta: { seat: mySeat.seat },
        });
        return { seatFreed: mySeat.seat, newOwnerId: null, tableClosed: false };
      }

      // Fall B: Owner verlässt, andere Menschen sind da → Owner-Wechsel.
      if (remainingHumans.length > 0) {
        // Niedrigster joinOrder unter den verbleibenden Menschen wird Owner.
        const nextOwner = remainingHumans[0]!; // bereits nach joinOrder sortiert
        await tx.lobbyTable.update({
          where: { id: tableId },
          data: { ownerId: nextOwner.userId! },
        });
        await this.audit.record({
          action: "lobby.table.owner.change",
          actorId: userId,
          target: tableId,
          meta: { previousOwner: userId, newOwner: nextOwner.userId, seat: mySeat.seat },
        });
        return { seatFreed: mySeat.seat, newOwnerId: nextOwner.userId, tableClosed: false };
      }

      // Fall C: Owner war der letzte Mensch → Tisch schließen.
      await tx.lobbyTable.update({
        where: { id: tableId },
        data: { status: LobbyTableStatus.CLOSED, closedAt: new Date() },
      });
      // KI-Sitze + offene Requests/Invites werden automatisch durch Cascade
      // gelöscht — bzw. bleiben als "stale" mit Status CANCELLED. Wir
      // markieren noch alle offenen Requests/Invites als CANCELLED, damit
      // betroffene User eine saubere Meldung sehen statt eines
      // verschwundenen Tisches.
      await tx.gameJoinRequest.updateMany({
        where: { tableId, status: JoinRequestStatus.PENDING },
        data: { status: JoinRequestStatus.CANCELLED, decidedAt: new Date() },
      });
      await tx.tableInvite.updateMany({
        where: { tableId, status: InviteStatus.PENDING },
        data: { status: InviteStatus.EXPIRED, respondedAt: new Date() },
      });
      await this.audit.record({
        action: "lobby.table.close",
        actorId: userId,
        target: tableId,
        meta: { reason: "owner-left-no-humans" },
      });
      return { seatFreed: mySeat.seat, newOwnerId: null, tableClosed: true };
    });

    // ─── M6-F: Pushes nach erfolgreicher Mutation ────────────────────
    if (result.tableClosed) {
      this.gateway.broadcastTableClosed(tableId);
      this.gateway.broadcastLobbyListUpdate("table-closed", tableId);
      // Pending-Requesters: ihr Request ist jetzt ungültig.
      for (const req of pendingRequesters) {
        this.gateway.pushToUser(req.userId, "lobby:request-decided", {
          tableId,
          approved: false,
          reason: "table-closed",
        });
      }
    } else {
      if (result.newOwnerId) {
        // Owner-Wechsel — pending Requesters informieren, dass jetzt ein
        // anderer User entscheidet (User-Entscheidung 2 aus der Vorschau).
        const newOwnerName = await this.prisma.user
          .findUnique({ where: { id: result.newOwnerId }, select: { name: true } })
          .then((u) => u?.name ?? "?");
        for (const req of pendingRequesters) {
          this.gateway.pushToUser(req.userId, "lobby:owner-changed", {
            tableId,
            previousOwnerId: userId,
            newOwnerId: result.newOwnerId,
            newOwnerName,
          });
        }
      }
      this.gateway.broadcastLobbyListUpdate("seat-changed", tableId);
      await this.pushTableState(tableId);
    }
    return result;
  }

  /**
   * Owner wirft einen menschlichen Mitspieler vom Tisch und sperrt ihn für
   * GENAU diesen Tisch (solange er lebt). Nur außerhalb einer laufenden Partie
   * (WAITING / MATCH_OVER) — während IN_GAME/POST_GAME erst nach Partie-Ende.
   * Bodensee (2 Spieler) hat keinen Mitspieler zum Entfernen. Die Sitz-Räumung
   * läuft über `leaveTable` (im erlaubten WAITING/MATCH_OVER-Fall: Sitz wird
   * frei, keine Quitter-Wertung); der Rausgeworfene ist nie der Owner → kein
   * Owner-Wechsel.
   */
  async kickAndBan(tableId: string, ownerId: string, targetUserId: string): Promise<void> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: {
        ownerId: true,
        variant: true,
        status: true,
        seats: { where: { userId: targetUserId }, select: { seat: true } },
      },
    });
    if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
    if (table.ownerId !== ownerId) {
      throw new ForbiddenException("Nur der Tisch-Ersteller darf Spieler entfernen.");
    }
    if (targetUserId === ownerId) {
      throw new BadRequestException(
        "Du kannst dich nicht selbst entfernen — nutze „Tisch verlassen“."
      );
    }
    if (table.variant === "BODENSEE_2P") {
      throw new BadRequestException(
        "Beim 2-Spieler-Bodensee gibt es keinen Mitspieler zum Entfernen."
      );
    }
    if (table.status === LobbyTableStatus.IN_GAME || table.status === LobbyTableStatus.POST_GAME) {
      throw new ConflictException(
        "Während einer laufenden Partie kann niemand entfernt werden — vor dem Start oder nach Partie-Ende."
      );
    }
    if (table.seats.length === 0) {
      throw new NotFoundException("Dieser Spieler sitzt nicht (mehr) an deinem Tisch.");
    }

    // Tisch-Bann (idempotent) — gilt, solange der Tisch lebt.
    await this.prisma.tableBan.upsert({
      where: { tableId_userId: { tableId, userId: targetUserId } },
      create: { tableId, userId: targetUserId, byUserId: ownerId },
      update: {},
    });
    await this.audit.record({
      action: "lobby.table.player_kicked",
      actorId: ownerId,
      target: tableId,
      meta: { kicked: targetUserId },
    });

    // Sitz räumen über die bewährte Verlassen-Mechanik (Broadcasts inklusive).
    await this.leaveTable(tableId, targetUserId);

    // Rausgeworfenem signalisieren → sein Client geht zurück in die Lobby.
    this.gateway.pushToUser(targetUserId, "lobby:kicked", { tableId });
  }

  /**
   * **Owner löst seinen Tisch auf** — schließt ihn für alle, UNABHÄNGIG davon,
   * ob der Owner gerade sitzt, und in jedem nicht-geschlossenen Zustand.
   *
   * Behebt den verwaisten Tisch („Owner nicht gesetzt, nur KI"): `leaveTable`
   * verlangt einen Sitz (`Du sitzt nicht an diesem Tisch.`) und greift dort
   * nicht. Owner-only.
   *
   * Bewusst KEIN `driveAIsToEnd`: ein evtl. laufendes Spiel wird einfach
   * abgebrochen (der Tisch ist CLOSED → keine neuen KI-Trigger). Das hält die
   * Methode variantensicher (Kreuz/Solo/Bodensee) und robust.
   */
  async closeTableAsOwner(tableId: string, userId: string): Promise<{ tableClosed: boolean }> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: { status: true, ownerId: true },
    });
    if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
    if (table.ownerId !== userId) {
      throw new ForbiddenException("Nur der Tisch-Owner kann den Tisch auflösen.");
    }
    if (table.status === LobbyTableStatus.CLOSED) {
      return { tableClosed: true }; // idempotent — schon zu, Wunsch erfüllt
    }
    // Schutz: Sitzen noch ECHTE Mitspieler (≠ Owner) am Tisch, wird NICHT
    // aufgelöst — sonst könnte der Owner anderen ein laufendes Spiel zerschießen.
    // Er soll dann „Verlassen" nutzen (Sitz → KI, Spiel läuft für die anderen
    // weiter). „Auflösen" bleibt damit reines Aufräum-Werkzeug für KI-/Wartetische.
    const otherHumans = await this.prisma.lobbyTableSeat.count({
      where: { tableId, userId: { not: null, notIn: [userId] } },
    });
    if (otherHumans > 0) {
      throw new ConflictException(
        'Am Tisch sitzen noch andere Menschen — bitte „Verlassen" statt „Auflösen" nutzen.'
      );
    }

    await this.audit.record({
      action: "lobby.table.dissolve",
      actorId: userId,
      target: tableId,
      meta: { reason: "owner-dissolve", previousStatus: table.status },
    });
    await this.dissolveTableCore(tableId);
    return { tableClosed: true };
  }

  /**
   * **Admin** löst EINEN beliebigen Tisch auf — Override ohne Owner-/Mitspieler-
   * Check (Moderation / globales Aufräumen). Für die Admin-Tisch-Übersicht.
   */
  async closeTableAsAdmin(adminId: string, tableId: string): Promise<{ tableClosed: boolean }> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: { status: true },
    });
    if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
    if (table.status === LobbyTableStatus.CLOSED) {
      return { tableClosed: true };
    }
    await this.audit.record({
      action: "admin.table.dissolve",
      actorId: adminId,
      target: tableId,
      meta: { previousStatus: table.status },
    });
    await this.dissolveTableCore(tableId);
    return { tableClosed: true };
  }

  /** Aktive (nicht geschlossene) Tische für die Admin-Übersicht. */
  async listActiveTablesForAdmin(): Promise<AdminTableView[]> {
    const tables = await this.prisma.lobbyTable.findMany({
      where: { status: { not: LobbyTableStatus.CLOSED } },
      include: {
        owner: { select: { id: true, name: true } },
        seats: { select: { userId: true, user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return tables.map((t) => {
      const humans = t.seats.filter((s) => s.userId !== null);
      return {
        id: t.id,
        ownerId: t.ownerId,
        ownerName: t.owner.name,
        status: t.status,
        variant: t.variant,
        createdAt: t.createdAt.toISOString(),
        humanCount: humans.length,
        aiCount: t.seats.length - humans.length,
        humanNames: humans.map((s) => s.user?.name ?? "?"),
        ownerSeated: t.seats.some((s) => s.userId === t.ownerId),
      };
    });
  }

  /**
   * Gemeinsamer Schließ-Kern: Status CLOSED + offene Requests/Invites canceln +
   * Broadcasts/Pushes. Genutzt von Owner- (`closeTableAsOwner`) und Admin-
   * Auflösen (`closeTableAsAdmin`).
   */
  private async dissolveTableCore(tableId: string): Promise<void> {
    const pendingRequesters = await this.prisma.gameJoinRequest.findMany({
      where: { tableId, status: JoinRequestStatus.PENDING },
      select: { userId: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.lobbyTable.update({
        where: { id: tableId },
        data: { status: LobbyTableStatus.CLOSED, closedAt: new Date() },
      });
      await tx.gameJoinRequest.updateMany({
        where: { tableId, status: JoinRequestStatus.PENDING },
        data: { status: JoinRequestStatus.CANCELLED, decidedAt: new Date() },
      });
      await tx.tableInvite.updateMany({
        where: { tableId, status: InviteStatus.PENDING },
        data: { status: InviteStatus.EXPIRED, respondedAt: new Date() },
      });
    });
    this.gateway.broadcastTableClosed(tableId);
    this.gateway.broadcastLobbyListUpdate("table-closed", tableId);
    for (const req of pendingRequesters) {
      this.gateway.pushToUser(req.userId, "lobby:request-decided", {
        tableId,
        approved: false,
        reason: "table-closed",
      });
    }
    await this.pushTableState(tableId);
  }

  // ───────────────────────────────────────────────────────────────────
  // Re-Match (M6-E)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Ergebnis-Tipps für einen Vote.
   *   - `pending`: noch nicht alle Menschen haben gevotet
   *   - `rematch-started`: alle YES → neues Game läuft, `gameId` neu gesetzt
   *   - `back-to-waiting`: mind. 1 NO → Tisch in WAITING, NO-Voter entfernt
   */
  async voteRematch(
    gameId: string,
    userId: string,
    dto: RematchVoteDto
  ): Promise<
    | { kind: "pending"; remainingVotes: number }
    | { kind: "rematch-started"; gameId: string; starter: number }
    | { kind: "back-to-waiting"; removedUserIds: string[] }
  > {
    // 1. Game + Tisch laden, Status prüfen, Caller-Sitz prüfen.
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        table: { include: { seats: { orderBy: { seat: "asc" } } } },
        rematchVotes: true,
      },
    });
    if (!game) throw new NotFoundException(`Game ${gameId} nicht gefunden`);
    if (!game.table) {
      throw new ConflictException("Game gehört zu keinem Tisch — kein Re-Match möglich.");
    }
    if (game.table.status !== LobbyTableStatus.POST_GAME) {
      throw new ConflictException(
        `Re-Match nur in POST_GAME möglich (aktuell ${game.table.status}).`
      );
    }
    // currentGameId muss auf dieses Game zeigen — sonst votet jemand für ein
    // alteres, längst abgeschlossenes Game.
    if (game.table.currentGameId !== gameId) {
      throw new ConflictException("Voting ist nur für das jüngste Game gültig.");
    }
    const mySeat = game.table.seats.find((s) => s.userId === userId);
    if (!mySeat) {
      throw new ForbiddenException("Du sitzt nicht an diesem Tisch.");
    }
    // Schon gevotet? Idempotent gestaltet: gleicher Vote = ok, anderer Vote
    // = Conflict (kein Umentscheiden).
    const existingVote = game.rematchVotes.find((v) => v.userId === userId);
    if (existingVote) {
      if (existingVote.vote === dto.vote) {
        // Re-Submit — wir behandeln das wie „Vote schon vorhanden" und melden
        // die aktuelle Lage.
        return this.evaluateRematchVotes(gameId);
      }
      throw new ConflictException("Du hast bereits abgestimmt; das ist endgültig.");
    }

    // 2. Vote eintragen.
    await this.prisma.rematchVote.create({
      data: { gameId, userId, vote: dto.vote },
    });
    await this.audit.record({
      action: "game.rematch.vote",
      actorId: userId,
      target: gameId,
      meta: { vote: dto.vote },
    });

    // 3. Auswerten: alle Menschen-Sitze müssen gevotet haben.
    const outcome = await this.evaluateRematchVotes(gameId);

    // M6-F: Vote broadcasten + Outcome-Event, falls finalisiert.
    if (outcome.kind === "pending") {
      this.gateway.broadcastRematchVoteCast(game.table.id, {
        gameId,
        userId,
        vote: dto.vote,
        remainingVotes: outcome.remainingVotes,
      });
    } else if (outcome.kind === "rematch-started") {
      this.gateway.broadcastRematchDecided(game.table.id, {
        kind: "rematch-started",
        gameId: outcome.gameId,
        starter: outcome.starter,
      });
      this.gateway.broadcastLobbyListUpdate("game-started", game.table.id);
      await this.pushTableState(game.table.id);
    } else {
      // back-to-waiting
      this.gateway.broadcastRematchDecided(game.table.id, {
        kind: "back-to-waiting",
        removedUserIds: outcome.removedUserIds,
      });
      this.gateway.broadcastLobbyListUpdate("rematch-declined", game.table.id);
      await this.pushTableState(game.table.id);
    }
    return outcome;
  }

  /**
   * **Neue Partie** nach `MATCH_OVER`. Setzt die kumulativen Scores
   * zurück und versetzt den Tisch wieder in WAITING — die Spieler bleiben
   * an ihren Sitzen, das Spiel wird (sobald wieder 4 voll) frisch
   * gestartet. Owner-only.
   *
   * Anders als `voteRematch` ist hier **kein Voting** nötig: die Partie
   * ist offiziell beendet, der Owner entscheidet einseitig, ob eine neue
   * Partie startet. Wer nicht weiterspielen will, kann den Tisch
   * vorher/nachher per `leaveTable` verlassen.
   */
  async startNewMatch(tableId: string, ownerId: string): Promise<{ tableId: string }> {
    const table = await this.requireOwner(tableId, ownerId);
    if (table.status !== LobbyTableStatus.MATCH_OVER) {
      throw new ConflictException(
        `Neue Partie nur nach MATCH_OVER möglich (aktuell ${table.status}).`
      );
    }

    // „Sieger gibt": Ansager der ersten Hand der neuen Partie aus dem
    // Match-Endstand bestimmen — VOR dem Zurücksetzen der kumulativen Scores.
    // Bei WELI bleibt das undefined → WELI-Halter sagt am Match-Start an.
    // Greift nur, wenn die neue Partie hier sofort startet (Tisch voll). Wird
    // der Tisch erst später wieder voll, fällt es auf WELI zurück.
    const nextAnnouncer = await this.computeMatchStartAnnouncer(tableId);

    await this.prisma.lobbyTable.update({
      where: { id: tableId },
      data: {
        status: LobbyTableStatus.WAITING,
        cumulativeScoreTeam0: 0,
        cumulativeScoreTeam1: 0,
        cumulativeScoreTeam2: 0,
        cumulativeScoreTeam3: 0,
        matchWinnerTeam: null,
        currentGameId: null,
        lastSeatChangeAt: new Date(),
      },
    });
    await this.audit.record({
      action: "lobby.table.new_match",
      actorId: ownerId,
      target: tableId,
    });
    // Falls der Tisch noch voll ist (alle Sitze besetzt), starten wir
    // gleich das nächste Game. Sonst wartet der Tisch im normalen
    // Auto-Fill-Flow.
    await this.tryAutoStartGame(tableId, nextAnnouncer);
    this.gateway.broadcastLobbyListUpdate("new-match", tableId);
    await this.pushTableState(tableId);
    return { tableId };
  }

  /**
   * Ansager der ersten Hand einer NEUEN Partie. Nur bei `restartMode =
   * SIEGER_GIBT` gesetzt — sonst `undefined` (→ WELI-Halter am Match-Start).
   * MUSS vor dem Score-Reset in `startNewMatch` aufgerufen werden, weil es die
   * Match-Endstände + den letzten Geber braucht.
   */
  private async computeMatchStartAnnouncer(tableId: string): Promise<number | undefined> {
    const t = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: {
        variant: true,
        restartMode: true,
        currentGameId: true,
        cumulativeScoreTeam0: true,
        cumulativeScoreTeam1: true,
        cumulativeScoreTeam2: true,
        cumulativeScoreTeam3: true,
      },
    });
    if (!t || t.restartMode !== "SIEGER_GIBT" || !t.currentGameId) return undefined;
    const lastGame = await this.prisma.game.findUnique({
      where: { id: t.currentGameId },
      include: { rounds: { orderBy: { roundIdx: "asc" } } },
    });
    const lastStarter = lastGame?.rounds[lastGame.rounds.length - 1]?.starter ?? 0;
    // Schluss-Stich-Starter für die exakte „Sieger gibt"-Regel: der Zug mit dem
    // höchsten trickIdx und der niedrigsten seq = erste Karte des letzten Stichs;
    // daraus ergibt sich dessen Wurf-Reihenfolge. Fehlt er (keine Moves), nimmt
    // matchStartAnnouncerSiegerGibt den Rotations-Fallback.
    const lastTrickLead = await this.prisma.move.findFirst({
      where: { gameId: t.currentGameId },
      orderBy: [{ trickIdx: "desc" }, { seq: "asc" }],
      select: { seat: true },
    });
    return matchStartAnnouncerSiegerGibt(
      t.variant,
      [
        t.cumulativeScoreTeam0,
        t.cumulativeScoreTeam1,
        t.cumulativeScoreTeam2,
        t.cumulativeScoreTeam3,
      ],
      lastStarter,
      lastTrickLead?.seat
    );
  }

  /**
   * Prüft, ob alle menschlichen Sitze des Tischs für `gameId` abgestimmt
   * haben, und führt das Outcome aus (neuer Game oder Tisch-zurück).
   */
  private async evaluateRematchVotes(
    gameId: string
  ): Promise<
    | { kind: "pending"; remainingVotes: number }
    | { kind: "rematch-started"; gameId: string; starter: number }
    | { kind: "back-to-waiting"; removedUserIds: string[] }
  > {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        table: { include: { seats: { orderBy: { seat: "asc" } } } },
        rematchVotes: true,
        rounds: { orderBy: { roundIdx: "asc" } },
      },
    });
    if (!game || !game.table) {
      throw new ConflictException("Game oder Tisch verschwunden.");
    }
    const humanSeats = game.table.seats.filter((s) => s.userId !== null);
    const votes = game.rematchVotes;
    const remaining = humanSeats.length - votes.length;
    if (remaining > 0) {
      return { kind: "pending", remainingVotes: remaining };
    }

    // Alle haben gevotet — auswerten.
    const noVoters = votes.filter((v) => v.vote === "NO").map((v) => v.userId);
    if (noVoters.length > 0) {
      // Mindestens ein NO → Tisch zurück nach WAITING, NO-Voter entfernen.
      await this.declineRematch(game.table.id, noVoters);
      return { kind: "back-to-waiting", removedUserIds: noVoters };
    }

    // Alle YES → neues Game starten.
    // Bodensee: eigener 2-Spieler-Service. Innerhalb eines Matches alterniert
    // der Ansager (2 Spieler = „nächster im Uhrzeigersinn"); der WELI bestimmt
    // den Ansager nur am Match-Start. Wir reichen den alternierenden Sitz
    // explizit durch, damit `createGame` nicht wieder den WELI-Halter nimmt.
    if (game.table.variant === "BODENSEE_2P") {
      const lastStarter = game.rounds[game.rounds.length - 1]?.starter ?? 0;
      const nextAnnouncer = (lastStarter + 1) % 2;
      const { gameId: bodenseeGameId } = await this.bodenseeGames.createGame({
        tableId: game.table.id,
        seats: game.table.seats.map((s) => ({
          seat: s.seat,
          userId: s.userId,
          aiSeatType: s.aiSeatType,
        })),
        announcerSeat: nextAnnouncer,
      });
      await this.audit.record({
        action: "game.rematch.started",
        target: game.table.id,
        meta: {
          previousGameId: gameId,
          newGameId: bodenseeGameId,
          variant: "BODENSEE_2P",
          starter: nextAnnouncer,
          rule: "rotate-clockwise",
        },
      });
      return { kind: "rematch-started", gameId: bodenseeGameId, starter: nextAnnouncer };
    }

    // Innerhalb eines Matches (Punkteziel noch nicht erreicht) rotiert der
    // Ansager im Uhrzeigersinn zum nächsten Sitz. Der `restartMode`
    // (WELI / „Sieger gibt") gilt NUR beim Match-Start, NICHT zwischen den
    // Händen — Vorarlberger Regel: der WELI bestimmt nur den allerersten
    // Ansager, danach gibt einfach der Nächste. Frisch austeilen, Ansager
    // explizit setzen (sonst liefe `createGame` in den WELI-Fallback).
    const lastStarter = game.rounds[game.rounds.length - 1]?.starter ?? 0;
    const seatCount = seatCountForVariant(game.table.variant);
    const newStarter = (lastStarter + 1) % seatCount;
    const newHands = dealCards(rematchRng());
    const newGameId = await this.startRematchGame(
      game.table.id,
      game.table.seats.map((s) => ({
        seat: s.seat,
        userId: s.userId,
        aiSeatType: s.aiSeatType,
      })),
      newStarter,
      newHands,
      variantEnumToGameType(game.table.variant)
    );
    await this.audit.record({
      action: "game.rematch.started",
      target: game.table.id,
      meta: {
        previousGameId: gameId,
        newGameId,
        starter: newStarter,
        rule: "rotate-clockwise", // restartMode greift nur am Match-Start
      },
    });
    return { kind: "rematch-started", gameId: newGameId, starter: newStarter };
  }

  /**
   * Tisch zurück nach WAITING; entferne alle Sitze der NO-Voter, setze
   * `lastSeatChangeAt` neu (= Auto-Fill-Timer-Reset). Wenn nach dem
   * Entfernen kein Mensch mehr da ist, wird der Tisch geschlossen
   * (analog zur leaveTable-Logik).
   */
  private async declineRematch(tableId: string, noVoterIds: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // NO-Voter-Sitze entfernen.
      for (const uid of noVoterIds) {
        await tx.lobbyTableSeat.deleteMany({ where: { tableId, userId: uid } });
      }

      // Was bleibt menschlich?
      const remaining = await tx.lobbyTableSeat.findMany({
        where: { tableId },
        orderBy: { joinOrder: "asc" },
      });
      const remainingHumans = remaining.filter((s) => s.userId !== null);

      if (remainingHumans.length === 0) {
        // Tisch schließen — analog leaveTable-Fall C.
        await tx.lobbyTable.update({
          where: { id: tableId },
          data: {
            status: LobbyTableStatus.CLOSED,
            closedAt: new Date(),
            currentGameId: null,
          },
        });
        await tx.gameJoinRequest.updateMany({
          where: { tableId, status: JoinRequestStatus.PENDING },
          data: { status: JoinRequestStatus.CANCELLED, decidedAt: new Date() },
        });
        await tx.tableInvite.updateMany({
          where: { tableId, status: InviteStatus.PENDING },
          data: { status: InviteStatus.EXPIRED, respondedAt: new Date() },
        });
        return;
      }

      // Owner-Wechsel, falls der Owner unter den NO-Voter war.
      const currentOwnerId = (
        await tx.lobbyTable.findUnique({
          where: { id: tableId },
          select: { ownerId: true },
        })
      )?.ownerId;
      const ownerLeft = currentOwnerId && noVoterIds.includes(currentOwnerId);
      const newOwnerId = ownerLeft ? remainingHumans[0]!.userId! : currentOwnerId!;

      await tx.lobbyTable.update({
        where: { id: tableId },
        data: {
          status: LobbyTableStatus.WAITING,
          currentGameId: null,
          lastSeatChangeAt: new Date(),
          ownerId: newOwnerId,
        },
      });
    });

    await this.audit.record({
      action: "game.rematch.declined",
      target: tableId,
      meta: { removedUserIds: noVoterIds },
    });
  }

  /**
   * Startet das neue Game am Tisch nach einem erfolgreichen YES-Vote.
   * Die Sitz-Konfiguration ist identisch, Karten sind frisch. Der Ansager
   * (`starter`) wird vom Caller bestimmt — innerhalb eines Matches der
   * nächste Sitz im Uhrzeigersinn (siehe `evaluateRematchVotes`). Wir
   * übergeben dem GameService nur Hände + `announcerSeat`; die Variante
   * bleibt offen, das Frontend zeigt dem Ansager den Dialog.
   */
  private async startRematchGame(
    tableId: string,
    seats: SeatAssignment[],
    starter: number,
    hands: Card[][],
    gameType: "kreuz" | "solo"
  ): Promise<string> {
    const { gameId } = await this.games.createGame({
      tableId,
      announcerSeat: starter,
      seats,
      hands,
      gameType,
    });
    return gameId;
  }

  // ───────────────────────────────────────────────────────────────────
  // Helfer
  // ───────────────────────────────────────────────────────────────────

  private async requireOpenTable(tableId: string): Promise<{
    id: string;
    status: LobbyTableStatus;
    joinMode: JoinMode;
  }> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: { id: true, status: true, joinMode: true },
    });
    if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
    if (table.status === LobbyTableStatus.CLOSED) {
      throw new ConflictException("Tisch ist geschlossen.");
    }
    if (table.status === LobbyTableStatus.IN_GAME) {
      throw new ConflictException("Spiel läuft bereits — Beitritt nicht möglich.");
    }
    return table;
  }

  private async requireOwner(
    tableId: string,
    callerId: string
  ): Promise<{ id: string; status: LobbyTableStatus; ownerId: string }> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: { id: true, status: true, ownerId: true },
    });
    if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
    if (table.ownerId !== callerId) {
      throw new ForbiddenException("Nur der Tisch-Owner darf das tun.");
    }
    return table;
  }

  private async requireNotAlreadySeated(tableId: string, userId: string): Promise<void> {
    const existing = await this.prisma.lobbyTableSeat.findFirst({
      where: { tableId, userId },
      select: { seat: true },
    });
    if (existing) {
      throw new ConflictException(`Du sitzt schon auf Sitz ${existing.seat}.`);
    }
  }

  /**
   * Wirft, wenn der User für DIESEN Tisch gesperrt ist (vom Owner rausgeworfen).
   * Tisch-scoped (`TableBan`), gilt solange der Tisch lebt.
   */
  private async requireNotBanned(tableId: string, userId: string): Promise<void> {
    const ban = await this.prisma.tableBan.findUnique({
      where: { tableId_userId: { tableId, userId } },
      select: { tableId: true },
    });
    if (ban) {
      throw new ForbiddenException(
        "Du wurdest von diesem Tisch entfernt und kannst ihm nicht wieder beitreten."
      );
    }
  }

  /**
   * Nächsten freien Sitz vergeben. Wirft, wenn der Tisch schon voll ist.
   * Muss innerhalb einer Transaktion laufen, weil sonst zwei parallele
   * Joins denselben Sitz bekommen könnten.
   */
  private async assignNextSeat(
    tx: Prisma.TransactionClient,
    tableId: string,
    userId: string
  ): Promise<number> {
    const tbl = await tx.lobbyTable.findUnique({
      where: { id: tableId },
      select: { variant: true },
    });
    const seatCount = seatCountForVariant(tbl?.variant ?? "KREUZ_4P");
    const occupied = await tx.lobbyTableSeat.findMany({
      where: { tableId },
      select: { seat: true, joinOrder: true },
    });
    const taken = new Set(occupied.map((s) => s.seat));
    let seat = -1;
    for (let i = 0; i < seatCount; i++) {
      if (!taken.has(i)) {
        seat = i;
        break;
      }
    }
    if (seat < 0) throw new ConflictException("Tisch ist voll.");
    const maxOrder = occupied.reduce((m, s) => Math.max(m, s.joinOrder), -1);
    await tx.lobbyTableSeat.create({
      data: { tableId, seat, userId, joinOrder: maxOrder + 1 },
    });
    // M6-D: Timer-Reset bei jeder Sitz-Mutation. Der Auto-Fill-Sweeper liest
    // `lastSeatChangeAt + autoFillSeconds`, also gibt jeder Join neue 30 s
    // Wartezeit.
    await tx.lobbyTable.update({
      where: { id: tableId },
      data: { lastSeatChangeAt: new Date() },
    });
    return seat;
  }

  private async assignSeatAndCloseInvite(
    tx: Prisma.TransactionClient,
    tableId: string,
    userId: string,
    inviteId: string
  ): Promise<number> {
    const seat = await this.assignNextSeat(tx, tableId, userId);
    await tx.tableInvite.update({
      where: { id: inviteId },
      data: { status: InviteStatus.ACCEPTED, respondedAt: new Date() },
    });
    return seat;
  }

  private async resolveInvitee(dto: InviteUserDto): Promise<{ id: string; name: string }> {
    if (dto.inviteeUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: dto.inviteeUserId },
        select: { id: true, name: true },
      });
      if (!u) throw new NotFoundException(`User ${dto.inviteeUserId} nicht gefunden`);
      return u;
    }
    const u = await this.prisma.user.findUnique({
      where: { name: dto.inviteeName! },
      select: { id: true, name: true },
    });
    if (!u) throw new NotFoundException(`User '${dto.inviteeName}' nicht gefunden`);
    return u;
  }

  // ───────────────────────────────────────────────────────────────────
  // Spiel-Start aus dem Tisch (M6-C)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Prüft, ob der Tisch jetzt voll und start-bereit ist; wenn ja, erzeugt
   * sofort ein Game über den GameService. Returnt die `gameId`, falls
   * gestartet, sonst `null`.
   *
   * Wird nach jedem Sitz-Assign (Open, Join, Approve, Accept-Invite,
   * Auto-Fill) aufgerufen. Idempotent — wenn der Tisch schon IN_GAME ist,
   * passiert nichts.
   */
  async tryAutoStartGame(tableId: string, announcerOverride?: number): Promise<string | null> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: {
        seats: { orderBy: { seat: "asc" } },
      },
    });
    if (!table) return null;
    if (table.status !== LobbyTableStatus.WAITING) return null;
    // Noch nicht voll → kein Start; evtl. laufenden Countdown abräumen.
    if (table.seats.length < seatCountForVariant(table.variant)) {
      this.seatSwap.cancelStartCountdown(tableId);
      return null;
    }
    // Rematch / expliziter Ansager: Aufstellung steht schon → sofort starten.
    if (announcerOverride !== undefined) {
      return this.startGameFromTable(table.id, announcerOverride);
    }
    // Bodensee (2 Spieler): keine Teams/Aufstellung → sofort starten.
    if (table.variant === "BODENSEE_2P") {
      return this.startGameFromTable(table.id);
    }
    // Läuft gerade ein Sitzplatz-Tausch, blockt der den Start komplett.
    if (this.seatSwap.isBusy(tableId)) {
      this.seatSwap.cancelStartCountdown(tableId);
      return null;
    }
    // 4er/Solo voll: Nur wenn ALLE vier Sitze von Menschen besetzt sind, gibt es
    // einen kurzen Start-Countdown als Tausch-Fenster — das ist der Fall, in dem
    // sich Menschen die Aufstellung überlegen. Der eigentliche Start passiert
    // dann in `fireStartCountdown`. Sind KI-Sitze dabei (Owner + KIs, Auto-Fill),
    // war das eine bewusste Aufstellung bzw. die Menschen hatten schon das
    // Auto-Fill-Fenster → sofort starten (auch für die bestehende Test-Erwartung).
    const allHuman = table.seats.every((s) => s.userId !== null);
    if (allHuman) {
      this.seatSwap.armStartCountdown(tableId);
      return null;
    }
    return this.startGameFromTable(table.id);
  }

  // ───────────────────────────────────────────────────────────────────
  // Sitzplatz-Wahl & -Tausch (Vorspiel-Aufstellung, 4er/Solo)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Vom Start-Countdown-Timer aufgerufen, wenn die Frist abgelaufen ist.
   * Prüft selbst nochmal (noch voll? WAITING? kein laufender Tausch?) und
   * startet dann. Idempotent/robust gegen zwischenzeitliche Änderungen.
   */
  async fireStartCountdown(tableId: string): Promise<void> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: { seats: { select: { seat: true } } },
    });
    if (!table || table.status !== LobbyTableStatus.WAITING) return;
    if (table.seats.length < seatCountForVariant(table.variant)) return;
    if (this.seatSwap.isBusy(tableId)) return;
    const gameId = await this.startGameFromTable(tableId);
    if (gameId) {
      await this.audit.record({
        action: "lobby.table.start.countdown",
        actorId: table.ownerId,
        target: tableId,
        meta: { gameId },
      });
      this.gateway.broadcastLobbyListUpdate("game-started", tableId);
      await this.pushTableState(tableId);
    }
  }

  /**
   * Nach Auflösung eines Tauschs (Annahme/Ablehnung/Timeout/Abbruch): Auto-Start
   * neu bewerten (Countdown ggf. neu armieren) und den State broadcasten. Eine
   * Methode, damit Arm-und-Push in fester Reihenfolge laufen (kein Race).
   */
  async afterSwapResolved(tableId: string): Promise<void> {
    await this.tryAutoStartGame(tableId);
    await this.pushTableState(tableId);
  }

  /**
   * Sitzplatz direkt wechseln — nur auf einen FREIEN oder KI-Sitz (kein
   * Einverständnis nötig). Auf einen menschlichen Sitz geht es nur über das
   * Tausch-Protokoll (`requestSeatSwap`). Nur in WAITING, nicht bei Bodensee.
   */
  async takeSeat(tableId: string, userId: string, targetSeat: number): Promise<{ seat: number }> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: { seats: true },
    });
    if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
    if (table.variant === "BODENSEE_2P") {
      throw new BadRequestException("Beim Bodensee gibt es keine Sitzplatz-Wahl.");
    }
    if (table.status !== LobbyTableStatus.WAITING) {
      throw new ConflictException("Sitzplatz wählen ist nur in der Wartephase möglich.");
    }
    const seatCount = seatCountForVariant(table.variant);
    if (targetSeat < 0 || targetSeat >= seatCount) {
      throw new BadRequestException("Ungültiger Sitzplatz.");
    }
    const mine = table.seats.find((s) => s.userId === userId);
    if (!mine) throw new NotFoundException("Du sitzt nicht an diesem Tisch.");
    if (mine.seat === targetSeat) return { seat: targetSeat };
    if (this.seatSwap.isBusy(tableId)) {
      throw new ConflictException("Während eines laufenden Sitzplatz-Tauschs nicht möglich.");
    }
    const targetRow = table.seats.find((s) => s.seat === targetSeat);
    if (targetRow?.userId) {
      throw new ConflictException(
        "Dieser Sitz ist von einem Mitspieler belegt — nutze „Sitzplatz tauschen“."
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (!targetRow) {
        // Freier Sitz: meine Row dorthin verschieben (delete+create, weil
        // `seat` Teil des PK ist — ein Update des PK-Felds vermeiden wir).
        await tx.lobbyTableSeat.delete({
          where: { tableId_seat: { tableId, seat: mine.seat } },
        });
        await tx.lobbyTableSeat.create({
          data: {
            tableId,
            seat: targetSeat,
            userId,
            joinOrder: mine.joinOrder,
            joinedAt: mine.joinedAt,
          },
        });
      } else {
        // KI-Sitz: Belegung tauschen (ich ↔ KI). `seat`-Felder bleiben fix,
        // nur die Inhaber-Felder wandern — joinOrder reist mit der Person.
        await tx.lobbyTableSeat.update({
          where: { tableId_seat: { tableId, seat: mine.seat } },
          data: {
            userId: null,
            aiSeatType: targetRow.aiSeatType,
            joinOrder: targetRow.joinOrder,
            joinedAt: targetRow.joinedAt,
          },
        });
        await tx.lobbyTableSeat.update({
          where: { tableId_seat: { tableId, seat: targetSeat } },
          data: { userId, aiSeatType: null, joinOrder: mine.joinOrder, joinedAt: mine.joinedAt },
        });
      }
      await tx.lobbyTable.update({
        where: { id: tableId },
        data: { lastSeatChangeAt: new Date() },
      });
    });

    await this.audit.record({
      action: "lobby.table.seat.take",
      actorId: userId,
      target: tableId,
      meta: { from: mine.seat, to: targetSeat },
    });
    // Sitz-Bewegung resettet den Start-Countdown (frisches Tausch-Fenster).
    await this.tryAutoStartGame(tableId);
    this.gateway.broadcastLobbyListUpdate("seat-changed", tableId);
    await this.pushTableState(tableId);
    return { seat: targetSeat };
  }

  /** Stufe 1: Anfragender drückt „Sitzplatz tauschen". */
  async requestSeatSwap(tableId: string, userId: string): Promise<void> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: { seats: true },
    });
    if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
    if (table.variant === "BODENSEE_2P") {
      throw new BadRequestException("Beim Bodensee gibt es keinen Sitzplatz-Tausch.");
    }
    if (table.status !== LobbyTableStatus.WAITING) {
      throw new ConflictException("Sitzplatz-Tausch ist nur in der Wartephase möglich.");
    }
    const mine = table.seats.find((s) => s.userId === userId);
    if (!mine) throw new NotFoundException("Du sitzt nicht an diesem Tisch.");
    const otherHumans = table.seats.filter((s) => s.userId && s.userId !== userId);
    if (otherHumans.length === 0) {
      throw new ConflictException("Es ist kein menschlicher Mitspieler zum Tauschen da.");
    }
    this.seatSwap.requestSwap(tableId, userId, mine.seat);
  }

  /** Stufe 1→2: Anfragender wählt den Sitz, mit dem getauscht werden soll. */
  async pickSeatSwapTarget(tableId: string, userId: string, targetSeat: number): Promise<void> {
    const targetRow = await this.prisma.lobbyTableSeat.findUnique({
      where: { tableId_seat: { tableId, seat: targetSeat } },
    });
    if (!targetRow || !targetRow.userId) {
      throw new BadRequestException("Auf diesem Sitz sitzt kein menschlicher Mitspieler.");
    }
    this.seatSwap.pickTarget(tableId, userId, targetSeat, targetRow.userId);
  }

  /** Stufe 2: Ziel antwortet auf die Tausch-Rückfrage. */
  async respondSeatSwap(tableId: string, userId: string, answer: SwapAnswer): Promise<void> {
    this.seatSwap.respondSwap(tableId, userId, answer);
  }

  /** Anfragender bricht in der Auswahl-Phase ab. */
  async cancelSeatSwap(tableId: string, userId: string): Promise<void> {
    this.seatSwap.cancelSwap(tableId, userId);
  }

  /**
   * Vom SeatSwapService bei Annahme aufgerufen: tauscht die beiden Sitz-Rows
   * in der DB, loggt, bewertet den Auto-Start neu und broadcastet.
   */
  async applyAcceptedSwap(
    tableId: string,
    seatA: number,
    seatB: number,
    requesterId: string,
    targetId: string
  ): Promise<void> {
    await this.swapSeatRows(tableId, seatA, seatB);
    await this.audit.record({
      action: "lobby.table.seat.swap",
      actorId: requesterId,
      target: tableId,
      meta: { seatA, seatB, withUserId: targetId },
    });
    this.gateway.broadcastLobbyListUpdate("seat-changed", tableId);
    await this.afterSwapResolved(tableId);
  }

  /**
   * Tauscht die Belegung zweier Sitz-Rows (userId/aiSeatType/joinOrder/joinedAt).
   * `seat` bleibt fix (Teil des PK) — es wandern nur die Inhaber-Felder, sodass
   * joinOrder bei der jeweiligen Person bleibt (wichtig für die Owner-Nachfolge).
   */
  private async swapSeatRows(tableId: string, seatA: number, seatB: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.lobbyTableSeat.findMany({
        where: { tableId, seat: { in: [seatA, seatB] } },
      });
      const a = rows.find((r) => r.seat === seatA);
      const b = rows.find((r) => r.seat === seatB);
      if (!a || !b) throw new ConflictException("Sitz nicht mehr vorhanden.");
      await tx.lobbyTableSeat.update({
        where: { tableId_seat: { tableId, seat: seatA } },
        data: {
          userId: b.userId,
          aiSeatType: b.aiSeatType,
          joinOrder: b.joinOrder,
          joinedAt: b.joinedAt,
        },
      });
      await tx.lobbyTableSeat.update({
        where: { tableId_seat: { tableId, seat: seatB } },
        data: {
          userId: a.userId,
          aiSeatType: a.aiSeatType,
          joinOrder: a.joinOrder,
          joinedAt: a.joinedAt,
        },
      });
      await tx.lobbyTable.update({
        where: { id: tableId },
        data: { lastSeatChangeAt: new Date() },
      });
    });
  }

  /**
   * Manueller Spielstart durch den Owner. Erzwingt das Auffüllen leerer
   * Sitze mit dem Default-KI-Typ des Tischs — der Owner überspringt damit
   * den Auto-Fill-Timer.
   */
  async startManually(tableId: string, ownerId: string): Promise<{ gameId: string }> {
    const table = await this.requireOwner(tableId, ownerId);
    if (table.status !== LobbyTableStatus.WAITING) {
      throw new ConflictException(
        `Tisch hat Status ${table.status} — manueller Start nur in WAITING möglich.`
      );
    }
    await this.prisma.$transaction(async (tx) => this.fillEmptySeatsWithAi(tx, tableId));
    const gameId = await this.startGameFromTable(tableId);
    if (!gameId) {
      // Sollte nie passieren — nach Fill-Up sind genau 4 Sitze belegt.
      throw new ConflictException("Tisch konnte nicht gestartet werden.");
    }
    await this.audit.record({
      action: "lobby.table.start.manual",
      actorId: ownerId,
      target: tableId,
      meta: { gameId },
    });
    this.gateway.broadcastLobbyListUpdate("game-started", tableId);
    await this.pushTableState(tableId);
    return { gameId };
  }

  /**
   * Eigentlicher Spiel-Start: lädt Tisch + Sitze, mappt auf SeatAssignment,
   * ruft GameService.createGame() — der setzt LobbyTable.status auf IN_GAME
   * und schreibt currentGameId in der gleichen Transaktion.
   *
   * Vorbedingung: Tisch ist 4 voll und in WAITING. Caller hat das geprüft.
   *
   * **Sprint C**: kein hard-coded Trumpf mehr. Das Game startet im
   * Ansage-Modus; `createGame` teilt die Karten aus. Ohne `announcerOverride`
   * sagt der WELI-Inhaber an (Vorarlberger Tradition, Match-Start). Mit
   * `announcerOverride` (nur „Sieger gibt", siehe `startNewMatch`) wird der
   * Ansager explizit gesetzt. Das Frontend zeigt dem Ansager den Dialog;
   * KI-Sitze antworten via `HeuristicPlayer.chooseAnnouncement`.
   */
  private async startGameFromTable(
    tableId: string,
    announcerOverride?: number
  ): Promise<string | null> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: { seats: { orderBy: { seat: "asc" } } },
    });
    if (!table || table.seats.length < seatCountForVariant(table.variant)) return null;

    // Spiel startet jetzt wirklich → allen ephemeren Tausch-/Countdown-Zustand
    // für diesen Tisch verwerfen (Timer stoppen).
    this.seatSwap.clearTable(tableId);

    const seats: SeatAssignment[] = table.seats.map((s) => ({
      seat: s.seat,
      userId: s.userId,
      aiSeatType: s.aiSeatType,
    }));

    // Bodensee-Jass läuft über den eigenen 2-Spieler-Service.
    if (table.variant === "BODENSEE_2P") {
      const { gameId } = await this.bodenseeGames.createGame({
        tableId,
        seats,
        ...(announcerOverride !== undefined ? { announcerSeat: announcerOverride } : {}),
      });
      this.log.log(
        { tableId, gameId, variant: table.variant },
        "Bodensee-Game aus Tisch gestartet (Ansage-Modus)"
      );
      return gameId;
    }

    const { gameId } = await this.games.createGame({
      tableId,
      seats,
      gameType: variantEnumToGameType(table.variant),
      ...(announcerOverride !== undefined ? { announcerSeat: announcerOverride } : {}),
    });
    this.log.log(
      { tableId, gameId, variant: table.variant },
      "Game aus Tisch gestartet (Ansage-Modus)"
    );
    return gameId;
  }

  /**
   * Befüllt alle noch leeren Sitze (0..3 \ existierende) mit KI vom
   * Tisch-Default-Typ. Wird vom manuellen Start sowie vom Auto-Fill-
   * Sweeper (M6-D) genutzt.
   */
  private async fillEmptySeatsWithAi(tx: Prisma.TransactionClient, tableId: string): Promise<void> {
    const table = await tx.lobbyTable.findUnique({
      where: { id: tableId },
      include: { seats: { select: { seat: true, joinOrder: true } } },
    });
    if (!table) return;
    const seatCount = seatCountForVariant(table.variant);
    const taken = new Set(table.seats.map((s) => s.seat));
    if (taken.size >= seatCount) return;
    const maxOrder = table.seats.reduce((m, s) => Math.max(m, s.joinOrder), -1);
    let order = maxOrder + 1;
    let inserted = 0;
    for (let i = 0; i < seatCount; i++) {
      if (taken.has(i)) continue;
      await tx.lobbyTableSeat.create({
        data: {
          tableId,
          seat: i,
          aiSeatType: table.aiSeatType,
          // KI-Sitze rücken nicht als Owner nach — hohe joinOrder.
          joinOrder: 100 + order++,
        },
      });
      inserted++;
    }
    if (inserted > 0) {
      // Timer-Reset auch beim Auto-Fill — auch wenn der Sweeper das Ding
      // ohnehin gleich auf IN_GAME schiebt, halten wir den Zeitstempel
      // konsistent.
      await tx.lobbyTable.update({
        where: { id: tableId },
        data: { lastSeatChangeAt: new Date() },
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Auto-Fill öffentliche API (für AutoFillService)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Vom `AutoFillService.tick()` aufgerufen, wenn ein Tisch fällig ist.
   * Befüllt die leeren Sitze mit dem Tisch-Default-KI-Typ und startet
   * das Spiel sofort. Idempotent — wenn der Tisch zwischenzeitlich
   * gestartet, voll oder geschlossen wurde, ist das ein no-op.
   *
   * **Audit**: Wir loggen `lobby.table.start.auto` (im Unterschied zum
   * `start.manual` aus `startManually`), damit Ops sehen kann, wie oft
   * Auto-Fill greift.
   */
  async autoFillAndStart(tableId: string): Promise<{ gameId: string | null }> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      select: { status: true, ownerId: true },
    });
    if (!table || table.status !== LobbyTableStatus.WAITING) {
      return { gameId: null };
    }
    await this.prisma.$transaction(async (tx) => this.fillEmptySeatsWithAi(tx, tableId));
    const gameId = await this.startGameFromTable(tableId);
    if (gameId) {
      await this.audit.record({
        action: "lobby.table.start.auto",
        actorId: table.ownerId, // System triggert, aber zugeordnet auf Owner
        target: tableId,
        meta: { gameId },
      });
      this.gateway.broadcastLobbyListUpdate("game-started", tableId);
      await this.pushTableState(tableId);
    }
    return { gameId };
  }
}

/**
 * Anzahl Sitze je Spielart. Bodensee-Jass ist ein 2-Spieler-Spiel; alle
 * übrigen Varianten haben 4 Sitze.
 */
function seatCountForVariant(variant: string): number {
  return variant === "BODENSEE_2P" ? 2 : 4;
}

/**
 * Mappt den DB-`GameVariant`-Enum auf die `GameType` des 4-Spieler-
 * `GameService` (`kreuz` | `solo`). SOLO_4P → solo, alles andere → kreuz.
 * BODENSEE_2P läuft über den eigenen `BodenseeGameService` und erreicht
 * diese Funktion gar nicht; KREUZ_6P / KREUZ_STEIGERN fallen
 * sicherheitshalber auf `kreuz` zurück.
 */
function variantEnumToGameType(variant: string): "kreuz" | "solo" {
  return variant === "SOLO_4P" ? "solo" : "kreuz";
}

/**
 * Baut das `cumulativeScores`-Array für die View-Layer. Kreuz-Jass hat
 * 2 Konten, Solo-Jass 4 (eines pro Spieler). Die DB hält immer 4 Felder;
 * bei Kreuz sind Team2/3 konstant 0 und werden hier weggeschnitten.
 */
function buildCumulativeScores(t: {
  variant: string;
  cumulativeScoreTeam0: number;
  cumulativeScoreTeam1: number;
  cumulativeScoreTeam2: number;
  cumulativeScoreTeam3: number;
}): number[] {
  const all = [
    t.cumulativeScoreTeam0,
    t.cumulativeScoreTeam1,
    t.cumulativeScoreTeam2,
    t.cumulativeScoreTeam3,
  ];
  return t.variant === "SOLO_4P" ? all : all.slice(0, 2);
}

/**
 * Wie `buildCumulativeScores`, aber für die über die Partie „im Sack"
 * verfallenen Punkte (reine Info-Anzeige, zählen nie zur Wertung).
 */
function buildSackedPoints(t: {
  variant: string;
  sackedPointsTeam0: number;
  sackedPointsTeam1: number;
  sackedPointsTeam2: number;
  sackedPointsTeam3: number;
}): number[] {
  const all = [t.sackedPointsTeam0, t.sackedPointsTeam1, t.sackedPointsTeam2, t.sackedPointsTeam3];
  return t.variant === "SOLO_4P" ? all : all.slice(0, 2);
}

/**
 * Crypto-RNG für Re-Match-Karten-Mischen. Wir nutzen Node-natives
 * `randomBytes` statt `Math.random`, damit WELI-Inhaber bzw. neue Hände
 * nicht aus dem `Math.random`-Seed vorhersagbar sind.
 */
function rematchRng(): RandomFn {
  return () => {
    const b = randomBytes(4).readUInt32BE(0);
    return b / 0x1_0000_0000;
  };
}
