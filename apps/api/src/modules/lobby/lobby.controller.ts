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
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { AfkService } from "../game/afk.service.js";
import { LobbyGateway } from "./lobby.gateway.js";
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
import {
  LobbyService,
  type IncomingInviteView,
  type TableDetailView,
  type TableListEntry,
} from "./lobby.service.js";
import { PresenceService, type PresenceState, type PresenceUser } from "./presence.service.js";

const AfkDtoSchema = z.object({ afk: z.boolean() }).strict();
type AfkDto = z.infer<typeof AfkDtoSchema>;

const KickDtoSchema = z.object({ userId: z.string().min(1) }).strict();
type KickDto = z.infer<typeof KickDtoSchema>;

const TakeSeatDtoSchema = z.object({ seat: z.number().int().min(0).max(3) }).strict();
type TakeSeatDto = z.infer<typeof TakeSeatDtoSchema>;

const SeatSwapPickDtoSchema = z.object({ seat: z.number().int().min(0).max(3) }).strict();
type SeatSwapPickDto = z.infer<typeof SeatSwapPickDtoSchema>;

const SeatSwapRespondDtoSchema = z
  .object({ answer: z.enum(["accept", "decline", "decline-forever"]) })
  .strict();
type SeatSwapRespondDto = z.infer<typeof SeatSwapRespondDtoSchema>;

@Controller("api/lobby")
@UseGuards(SessionGuard)
export class LobbyController {
  constructor(
    private readonly lobby: LobbyService,
    private readonly presence: PresenceService,
    private readonly afk: AfkService,
    private readonly gateway: LobbyGateway
  ) {}

  // ─── Online-Präsenz ────────────────────────────────────────────────

  /**
   * Aktuell in der App verbundene User (≥ 1 aktiver WS-Socket). Genutzt von
   * der Lobby-UI für die „Wer ist gerade da?"-Liste. Polled vom Client
   * (typisch ~15 s); kein WS-Push nötig, weil die Liste nicht zeitkritisch ist.
   */
  @Get("presence")
  async listPresence(@Req() req: FastifyRequest): Promise<{ users: PresenceUser[] }> {
    const users = await this.presence.list(req.user!.id);
    return { users };
  }

  /**
   * Präsenz-Status (online + zuletzt-gesehen) für gezielte User-IDs — für die
   * Online-Punkte an Namen. `?ids=a,b,c` (komma-separiert, max. 100). Pro Ziel
   * wird die Präsenz-Sichtbarkeit des Users durchgesetzt.
   */
  @Get("presence/status")
  async presenceStatus(
    @Req() req: FastifyRequest,
    @Query("ids") ids?: string
  ): Promise<{ statuses: Record<string, { state: PresenceState; lastSeenAt: string | null }> }> {
    const list = (ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const statuses = await this.presence.statusFor(req.user!.id, list);
    return { statuses };
  }

  // ─── AFK / Pause ───────────────────────────────────────────────────

  @Get("afk")
  async getAfk(@Req() req: FastifyRequest): Promise<{ afk: boolean }> {
    return { afk: await this.afk.isAfk(req.user!.id) };
  }

  /**
   * AFK-Modus setzen. AFK **an** ist nur erlaubt, solange man an keinem Tisch
   * sitzt (sonst könnte man eine Partie blockieren). Bei Erfolg wird ein
   * `presence:afk`-Event an alle Geräte des Users gepusht (Overlay an/aus).
   */
  @Post("afk")
  async setAfk(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(AfkDtoSchema)) dto: AfkDto
  ): Promise<{ afk: boolean }> {
    const userId = req.user!.id;
    if (dto.afk && (await this.presence.isAtTable(userId))) {
      throw new ForbiddenException("AFK ist nicht möglich, solange du an einem Tisch sitzt.");
    }
    await this.afk.setAfk(userId, dto.afk);
    this.gateway.pushToUser(userId, "presence:afk", { afk: dto.afk });
    return { afk: dto.afk };
  }

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
   * Owner löst den Tisch auf — schließt ihn für alle, auch wenn der Owner
   * nicht (mehr) sitzt. Behebt verwaiste Tische, die `leave` nicht greift.
   */
  @Post("tables/:id/close")
  async close(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<{ tableClosed: boolean }> {
    return this.lobby.closeTableAsOwner(tableId, req.user!.id);
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

  /**
   * Neue Partie nach MATCH_OVER: kumulative Punkte zurücksetzen, Tisch
   * wieder WAITING. Owner-only.
   */
  @Post("tables/:id/new-match")
  async newMatch(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<{ tableId: string }> {
    return this.lobby.startNewMatch(tableId, req.user!.id);
  }

  /**
   * Owner wirft einen menschlichen Mitspieler vom Tisch und sperrt ihn für
   * diese Tisch-ID (Aufruf aus dem Namens-Kontextmenü). Nur außerhalb einer
   * laufenden Partie; Bodensee ausgenommen (2 Spieler).
   */
  @Post("tables/:id/kick")
  async kick(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Body(new ZodValidationPipe(KickDtoSchema)) dto: KickDto
  ): Promise<{ ok: true }> {
    await this.lobby.kickAndBan(tableId, req.user!.id, dto.userId);
    return { ok: true };
  }

  // ─── Sitzplatz-Wahl & -Tausch (Wartebereich, 4er/Solo) ────────────

  /** Auf einen FREIEN oder KI-Sitz wechseln (kein Einverständnis nötig). */
  @Post("tables/:id/seat")
  async takeSeat(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Body(new ZodValidationPipe(TakeSeatDtoSchema)) dto: TakeSeatDto
  ): Promise<{ seat: number }> {
    return this.lobby.takeSeat(tableId, req.user!.id, dto.seat);
  }

  /** Stufe 1: „Sitzplatz tauschen" drücken (öffnet das 30-s-Auswahlfenster). */
  @Post("tables/:id/seat-swap/request")
  async requestSeatSwap(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<{ ok: true }> {
    await this.lobby.requestSeatSwap(tableId, req.user!.id);
    return { ok: true };
  }

  /** Stufe 1→2: Den Sitz wählen, mit dem getauscht werden soll. */
  @Post("tables/:id/seat-swap/pick")
  async pickSeatSwapTarget(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Body(new ZodValidationPipe(SeatSwapPickDtoSchema)) dto: SeatSwapPickDto
  ): Promise<{ ok: true }> {
    await this.lobby.pickSeatSwapTarget(tableId, req.user!.id, dto.seat);
    return { ok: true };
  }

  /** Stufe 2: Auf die Tausch-Rückfrage antworten (Ziel). */
  @Post("tables/:id/seat-swap/respond")
  async respondSeatSwap(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string,
    @Body(new ZodValidationPipe(SeatSwapRespondDtoSchema)) dto: SeatSwapRespondDto
  ): Promise<{ ok: true }> {
    await this.lobby.respondSeatSwap(tableId, req.user!.id, dto.answer);
    return { ok: true };
  }

  /** Anfragenden Tausch in der Auswahl-Phase abbrechen. */
  @Post("tables/:id/seat-swap/cancel")
  async cancelSeatSwap(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<{ ok: true }> {
    await this.lobby.cancelSeatSwap(tableId, req.user!.id);
    return { ok: true };
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

  /**
   * Offene Einladungen AN den eingeloggten User — für die bleibende
   * „Du wurdest eingeladen"-Liste in der Lobby (Empfänger-Sicht).
   */
  @Get("invites/incoming")
  async incomingInvites(@Req() req: FastifyRequest): Promise<{ invites: IncomingInviteView[] }> {
    const invites = await this.lobby.listIncomingInvites(req.user!.id);
    return { invites };
  }

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
