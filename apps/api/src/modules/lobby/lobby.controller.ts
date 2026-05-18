/**
 * REST-Endpunkte für die Lobby. Alle Endpunkte verlangen eine eingeloggte
 * Session (SessionGuard). Owner-Pflicht wird im Service geprüft, nicht via
 * separatem Guard — weil der Owner-Check pro Tisch dynamisch ist und nicht
 * deklarativ ableitbar.
 *
 * Pfad-Konvention: `/api/lobby/tables/*`. Re-Match-Endpunkte (POST .../vote,
 * POST .../start) liegen unter `/api/games/...` und kommen mit M6-C/E.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import {
  InviteUserDtoSchema,
  ListTablesQuerySchema,
  OpenTableDtoSchema,
  UpdateTableSettingsDtoSchema,
  type InviteUserDto,
  type ListTablesQuery,
  type OpenTableDto,
  type UpdateTableSettingsDto,
} from "./lobby.dto.js";
import { LobbyService, type TableDetailView, type TableListEntry } from "./lobby.service.js";

@Controller("api/lobby")
@UseGuards(SessionGuard)
export class LobbyController {
  constructor(private readonly lobby: LobbyService) {}

  // ─── Tisch-CRUD ────────────────────────────────────────────────────

  @Post("tables")
  async open(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(OpenTableDtoSchema)) dto: OpenTableDto
  ): Promise<{ tableId: string }> {
    return this.lobby.openTable(req.user!.id, dto);
  }

  @Get("tables")
  async list(
    @Req() req: FastifyRequest,
    @Query(new ZodValidationPipe(ListTablesQuerySchema)) query: ListTablesQuery
  ): Promise<{ tables: TableListEntry[] }> {
    const tables = await this.lobby.listTables(req.user!.id, query);
    return { tables };
  }

  /**
   * Tische, an denen der eingeloggte User aktuell sitzt (oder die er
   * besitzt). Für die Lobby-Karte „Du bist gerade in einem Tisch" —
   * damit der User nach einer Navigation zurückfindet.
   *
   * Filter: WAITING + IN_GAME + POST_GAME. CLOSED-Tische sind weg.
   */
  @Get("my-tables")
  async myTables(@Req() req: FastifyRequest): Promise<{ tables: TableListEntry[] }> {
    const tables = await this.lobby.listMyTables(req.user!.id);
    return { tables };
  }

  @Get("tables/:id")
  async get(@Req() req: FastifyRequest, @Param("id") tableId: string): Promise<TableDetailView> {
    return this.lobby.getTableView(tableId, req.user!.id);
  }

  @Patch("tables/:id")
  async updateSettings(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Body(new ZodValidationPipe(UpdateTableSettingsDtoSchema)) dto: UpdateTableSettingsDto
  ): Promise<{ ok: true }> {
    await this.lobby.updateSettings(tableId, req.user!.id, dto);
    return { ok: true };
  }

  // ─── Beitritt ──────────────────────────────────────────────────────

  @Post("tables/:id/join")
  async join(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<
    | { kind: "seated"; seat: number }
    | { kind: "request-pending"; requestId: string }
    | { kind: "invite-used"; seat: number }
  > {
    return this.lobby.joinTable(tableId, req.user!.id);
  }

  @Post("tables/:id/leave")
  async leave(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<{
    seatFreed: number | null;
    newOwnerId: string | null;
    tableClosed: boolean;
  }> {
    return this.lobby.leaveTable(tableId, req.user!.id);
  }

  /**
   * Owner startet das Spiel manuell — überspringt den Auto-Fill-Timer.
   * Wenn der Tisch noch leere Sitze hat, werden sie mit dem Tisch-
   * Default-KI-Typ gefüllt, dann startet das Game.
   */
  @Post("tables/:id/start")
  async start(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<{ gameId: string }> {
    return this.lobby.startManually(tableId, req.user!.id);
  }

  // ─── Beitritts-Anfragen (REQUEST-Modus) ───────────────────────────

  @Delete("tables/:id/join-requests/me")
  async cancelMyRequest(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<{ ok: true }> {
    await this.lobby.cancelJoinRequest(tableId, req.user!.id);
    return { ok: true };
  }

  @Post("tables/:id/join-requests/:rid/approve")
  async approveRequest(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Param("rid") requestId: string
  ): Promise<{ seat: number }> {
    return this.lobby.approveJoinRequest(tableId, requestId, req.user!.id);
  }

  @Post("tables/:id/join-requests/:rid/deny")
  async denyRequest(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Param("rid") requestId: string
  ): Promise<{ ok: true }> {
    await this.lobby.denyJoinRequest(tableId, requestId, req.user!.id);
    return { ok: true };
  }

  // ─── Einladungen ───────────────────────────────────────────────────

  @Post("tables/:id/invites")
  async invite(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Body(new ZodValidationPipe(InviteUserDtoSchema)) dto: InviteUserDto
  ): Promise<{ inviteId: string; inviteeUserId: string }> {
    return this.lobby.inviteUser(tableId, req.user!.id, dto);
  }

  @Post("tables/:id/invites/:iid/accept")
  async acceptInvite(
    @Req() req: FastifyRequest,
    @Param("id") _tableId: string,
    @Param("iid") inviteId: string
  ): Promise<{ seat: number }> {
    return this.lobby.acceptInvite(inviteId, req.user!.id);
  }

  @Post("tables/:id/invites/:iid/decline")
  async declineInvite(
    @Req() req: FastifyRequest,
    @Param("id") _tableId: string,
    @Param("iid") inviteId: string
  ): Promise<{ ok: true }> {
    await this.lobby.declineInvite(inviteId, req.user!.id);
    return { ok: true };
  }

  @Post("tables/:id/invites/:iid/cancel")
  async cancelInvite(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Param("iid") inviteId: string
  ): Promise<{ ok: true }> {
    await this.lobby.cancelInvite(tableId, inviteId, req.user!.id);
    return { ok: true };
  }
}
