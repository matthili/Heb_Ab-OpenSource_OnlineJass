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

import { dealCards, isWeli, type Card, type RandomFn } from "@jass/engine";

import { AuditService } from "../audit/audit.service.js";
import { GameService, type SeatAssignment } from "../game/game.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  InviteUserDto,
  ListTablesQuery,
  OpenTableDto,
  RematchVoteDto,
  UpdateTableSettingsDto,
} from "./lobby.dto.js";

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
  aiSeatType: string;
  autoFillSeconds: number | null;
  restartMode: "WELI" | "SIEGER_GIBT";
  seatsTaken: number; // 1..4
  hasPendingRequest: boolean; // ist der Caller eingetragen?
  createdAt: Date;
}

/** Detail-View. Owner-spezifische Felder (joinRequests, invites) nur, wenn
 *  der Caller der Owner ist. */
export interface TableDetailView extends TableListEntry {
  seats: SeatView[];
  currentGameId: string | null;
  joinRequests?: { id: string; userId: string; userName: string; createdAt: Date }[];
  invites?: { id: string; inviteeUserId: string; inviteeName: string; createdAt: Date }[];
}

@Injectable()
export class LobbyService {
  private readonly log = new Logger(LobbyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly games: GameService
  ) {}

  // ───────────────────────────────────────────────────────────────────
  // Tisch öffnen
  // ───────────────────────────────────────────────────────────────────

  async openTable(ownerId: string, dto: OpenTableDto): Promise<{ tableId: string }> {
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

    const table = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lobbyTable.create({
        data: {
          ownerId,
          joinMode: dto.joinMode,
          variant: dto.variant,
          aiSeatType: dto.aiSeatType,
          autoFillSeconds: dto.autoFillSeconds,
          restartMode: dto.restartMode,
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
      take: 100, // sicheres Limit für M6; Pagination in M7
    });

    return tables.map((t) => ({
      id: t.id,
      ownerId: t.ownerId,
      ownerName: t.owner.name,
      status: t.status,
      joinMode: t.joinMode,
      aiSeatType: t.aiSeatType,
      autoFillSeconds: t.autoFillSeconds,
      restartMode: t.restartMode as "WELI" | "SIEGER_GIBT",
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

    // 4-Sitz-Layout: leere Sitze als Platzhalter zeigen, damit die UI alle
    // Plätze rendern kann.
    const seatsByIndex = new Map(table.seats.map((s) => [s.seat, s]));
    const seats: SeatView[] = [];
    for (let i = 0; i < 4; i++) {
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
      aiSeatType: table.aiSeatType,
      autoFillSeconds: table.autoFillSeconds,
      restartMode: table.restartMode as "WELI" | "SIEGER_GIBT",
      seatsTaken: table.seats.length,
      hasPendingRequest: callerHasPendingRequest > 0,
      createdAt: table.createdAt,
      seats,
      currentGameId: table.currentGameId,
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
        return { seat };
      })
      .then(async (result) => {
        // Auto-Start außerhalb der Transaktion: der GameService öffnet seine
        // eigene Transaktion und das nesten würde unnötig blockieren.
        await this.tryAutoStartGame(tableId);
        return result;
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
      },
    });
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
    return this.prisma.$transaction(async (tx) => {
      const table = await tx.lobbyTable.findUnique({
        where: { id: tableId },
        include: { seats: { orderBy: { joinOrder: "asc" } } },
      });
      if (!table) throw new NotFoundException(`Tisch ${tableId} nicht gefunden`);
      if (table.status === LobbyTableStatus.CLOSED) {
        throw new ConflictException("Tisch ist bereits geschlossen.");
      }
      // M6-B-Restriktion: Verlassen nur in WAITING. POST_GAME-Leave kommt
      // mit M6-E (Re-Match-Vote ergibt sich daraus).
      if (table.status !== LobbyTableStatus.WAITING) {
        throw new ConflictException(
          "Verlassen ist aktuell nur in der WAITING-Phase implementiert. " +
            "Re-Match-Phase folgt mit M6-E."
        );
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
    return this.evaluateRematchVotes(gameId);
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
    const lastStarter = game.rounds[game.rounds.length - 1]?.starter ?? 0;
    const finalScore = (game.finalScore ?? null) as {
      team_card_points: number[];
    } | null;
    const { newStarter, newHands } = this.computeRematchStartAndHands(
      game.table.restartMode as "WELI" | "SIEGER_GIBT",
      lastStarter,
      finalScore
    );
    const newGameId = await this.startRematchGame(
      game.table.id,
      game.table.seats.map((s) => ({
        seat: s.seat,
        userId: s.userId,
        aiSeatType: s.aiSeatType,
      })),
      newStarter,
      newHands
    );
    await this.audit.record({
      action: "game.rematch.started",
      target: game.table.id,
      meta: {
        previousGameId: gameId,
        newGameId,
        restartMode: game.table.restartMode,
        starter: newStarter,
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
   * Die Sitz-Konfiguration ist identisch (User-Entscheidung 3), Karten
   * sind frisch, Starter ist nach `restartMode` bestimmt.
   */
  private async startRematchGame(
    tableId: string,
    seats: SeatAssignment[],
    starter: number,
    hands: Card[][]
  ): Promise<string> {
    const variant = { mode: "TRUMPF" as const, trump_suit: "EICHEL" as const };
    const { gameId } = await this.games.createGame({
      tableId,
      variant,
      announcement: { variant, slalom: false },
      starter,
      seats,
      hands,
    });
    return gameId;
  }

  /**
   * Berechnet Starter und neue Hände nach `restartMode`.
   *
   * **WELI**: Karten werden gemischt; wer das Welli (Schelle-6) bekommt,
   * ist Starter. Das ist effektiv eine zufällige Wahl mit
   * Welli-Inhaber-Probability, deterministisch aus dem Mischen ableitbar.
   *
   * **SIEGER_GIBT**: Hände werden ebenfalls gemischt, aber der Starter wird
   * nicht aus den Karten gelesen, sondern aus dem letzten Game-Ergebnis:
   *   - Geber des letzten Spiels: `(lastStarter - 1 + 4) % 4`
   *   - Neuer Geber: der nächste im Uhrzeigersinn nach lastDealer, der zum
   *     Sieger-Team gehört
   *   - Starter: `(newDealer + 1) % 4`
   *
   * Bei Gleichstand der Teams (unwahrscheinlich, weil Punktesumme 157
   * ungerade ist) gewinnt Team 0 — pragma, deterministisch.
   */
  private computeRematchStartAndHands(
    mode: "WELI" | "SIEGER_GIBT",
    lastStarter: number,
    finalScore: { team_card_points: number[] } | null
  ): { newStarter: number; newHands: Card[][] } {
    // Standard-Kreuz-Jass-Teams: Sitz 0+2 = Team 0, Sitz 1+3 = Team 1.
    const TEAMS = [0, 1, 0, 1];
    const hands = dealCards(rematchRng());
    if (mode === "WELI") {
      for (let seat = 0; seat < 4; seat++) {
        if (hands[seat]!.some((c) => isWeli(c))) {
          return { newStarter: seat, newHands: hands };
        }
      }
      // Welli muss irgendwo sein (es ist im Deck) — defensiv.
      throw new Error("WELI-Modus: Welli-Karte nicht in den Händen gefunden");
    }
    // SIEGER_GIBT
    const points = finalScore?.team_card_points ?? [0, 0];
    const winningTeam = (points[0] ?? 0) >= (points[1] ?? 0) ? 0 : 1;
    const lastDealer = (lastStarter - 1 + 4) % 4;
    let newDealer = lastDealer;
    for (let i = 1; i <= 4; i++) {
      const candidate = (lastDealer + i) % 4;
      if (TEAMS[candidate] === winningTeam) {
        newDealer = candidate;
        break;
      }
    }
    const newStarter = (newDealer + 1) % 4;
    return { newStarter, newHands: hands };
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
   * Nächsten freien Sitz vergeben. Wirft, wenn der Tisch schon voll ist.
   * Muss innerhalb einer Transaktion laufen, weil sonst zwei parallele
   * Joins denselben Sitz bekommen könnten.
   */
  private async assignNextSeat(
    tx: Prisma.TransactionClient,
    tableId: string,
    userId: string
  ): Promise<number> {
    const occupied = await tx.lobbyTableSeat.findMany({
      where: { tableId },
      select: { seat: true, joinOrder: true },
    });
    const taken = new Set(occupied.map((s) => s.seat));
    let seat = -1;
    for (let i = 0; i < 4; i++) {
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
  async tryAutoStartGame(tableId: string): Promise<string | null> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: {
        seats: { orderBy: { seat: "asc" } },
      },
    });
    if (!table) return null;
    if (table.status !== LobbyTableStatus.WAITING) return null;
    if (table.seats.length < 4) return null;

    return this.startGameFromTable(table.id);
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
    return { gameId };
  }

  /**
   * Eigentlicher Spiel-Start: lädt Tisch + Sitze, mappt auf SeatAssignment,
   * ruft GameService.createGame() — der setzt LobbyTable.status auf IN_GAME
   * und schreibt currentGameId in der gleichen Transaktion.
   *
   * Vorbedingung: Tisch ist 4 voll und in WAITING. Caller hat das geprüft.
   *
   * **M6-Vereinfachung**: Trumpf ist hard-coded `EICHEL`, Starter = 0
   * (Owner). Re-Match (M6-E) berechnet den Starter dynamisch nach Welli /
   * Sieger-Gibt; die Trumpf-Ansage-UI kommt mit M7 (Frontend).
   */
  private async startGameFromTable(tableId: string): Promise<string | null> {
    const table = await this.prisma.lobbyTable.findUnique({
      where: { id: tableId },
      include: { seats: { orderBy: { seat: "asc" } } },
    });
    if (!table || table.seats.length < 4) return null;

    const seats: SeatAssignment[] = table.seats.map((s) => ({
      seat: s.seat,
      userId: s.userId,
      aiSeatType: s.aiSeatType,
    }));

    const variant = { mode: "TRUMPF" as const, trump_suit: "EICHEL" as const };
    const { gameId } = await this.games.createGame({
      tableId,
      variant,
      announcement: { variant, slalom: false },
      starter: 0,
      seats,
    });
    this.log.log({ tableId, gameId }, "Game aus Tisch gestartet");
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
    const taken = new Set(table.seats.map((s) => s.seat));
    if (taken.size >= 4) return;
    const maxOrder = table.seats.reduce((m, s) => Math.max(m, s.joinOrder), -1);
    let order = maxOrder + 1;
    let inserted = 0;
    for (let i = 0; i < 4; i++) {
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
    }
    return { gameId };
  }
}

/**
 * Crypto-RNG für Re-Match-Karten-Mischen. Wir nutzen Node-natives
 * `randomBytes` statt `Math.random`, damit Welli-Inhaber bzw. neue Hände
 * nicht aus dem `Math.random`-Seed vorhersagbar sind.
 */
function rematchRng(): RandomFn {
  return () => {
    const b = randomBytes(4).readUInt32BE(0);
    return b / 0x1_0000_0000;
  };
}
