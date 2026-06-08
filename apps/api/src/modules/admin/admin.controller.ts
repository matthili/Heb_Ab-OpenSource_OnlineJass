/**
 * REST-Endpunkte unter `/api/admin` — alle ADMIN-only.
 *
 * Guard-Reihenfolge: `SessionGuard` setzt `req.user`, dann prüft
 * `RolesGuard` die DB-Rolle gegen `@Roles("ADMIN")`. Bei Status
 * `BLOCKED` oder `DELETED_SOFT` lehnt RolesGuard ab.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { BannedWordsService, type BannedWordView } from "../chat/banned-words.service.js";
import { LobbySettingsService, type LobbySettings } from "../lobby/lobby-settings.service.js";
import {
  AddBannedWordDtoSchema,
  AddBlocklistDtoSchema,
  ListAuditQuerySchema,
  ListUsersQuerySchema,
  SetAdminNoteDtoSchema,
  SetUserRoleDtoSchema,
  SetUserStatusDtoSchema,
  SmtpSettingsDtoSchema,
  UpdateLobbySettingsDtoSchema,
  type AddBannedWordDto,
  type AddBlocklistDto,
  type ListAuditQuery,
  type ListUsersQuery,
  type SetAdminNoteDto,
  type SetUserRoleDto,
  type SetUserStatusDto,
  type SmtpSettingsDto,
  type UpdateLobbySettingsDto,
} from "./admin.dto.js";
import {
  AdminService,
  type AdminAuditEntry,
  type AdminQuitterEntry,
  type AdminUserView,
} from "./admin.service.js";

@Controller("api/admin")
@UseGuards(SessionGuard, RolesGuard)
@Roles("ADMIN")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly bannedWords: BannedWordsService,
    private readonly lobbySettings: LobbySettingsService
  ) {}

  // ─── SMTP ──────────────────────────────────────────────────────────

  @Get("smtp")
  getSmtp() {
    return this.admin.getSmtp();
  }

  @Put("smtp")
  async updateSmtp(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(SmtpSettingsDtoSchema)) dto: SmtpSettingsDto
  ): Promise<{ ok: true }> {
    await this.admin.updateSmtp(req.user!.id, dto);
    return { ok: true };
  }

  // ─── Blocklist ─────────────────────────────────────────────────────

  @Get("blocklist")
  async listBlocklist(): Promise<{
    entries: { pattern: string; reason: string | null; createdAt: string }[];
  }> {
    const entries = await this.admin.listBlocklist();
    return { entries };
  }

  @Post("blocklist")
  async addBlocklist(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(AddBlocklistDtoSchema)) dto: AddBlocklistDto
  ): Promise<{ ok: true }> {
    await this.admin.addBlocklistPattern(req.user!.id, dto);
    return { ok: true };
  }

  @Delete("blocklist/:pattern")
  async removeBlocklist(
    @Req() req: FastifyRequest,
    @Param("pattern") pattern: string
  ): Promise<{ ok: true }> {
    await this.admin.removeBlocklistPattern(req.user!.id, pattern);
    return { ok: true };
  }

  // ─── Chat-Wortfilter ───────────────────────────────────────────────

  @Get("banned-words")
  async listBannedWords(): Promise<{ entries: BannedWordView[] }> {
    const entries = await this.bannedWords.list();
    return { entries };
  }

  @Post("banned-words")
  async addBannedWord(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(AddBannedWordDtoSchema)) dto: AddBannedWordDto
  ): Promise<{ ok: true }> {
    await this.bannedWords.add(req.user!.id, dto.word, dto.reason ?? null);
    return { ok: true };
  }

  @Delete("banned-words/:word")
  async removeBannedWord(
    @Req() req: FastifyRequest,
    @Param("word") word: string
  ): Promise<{ ok: true }> {
    await this.bannedWords.remove(req.user!.id, word);
    return { ok: true };
  }

  // ─── Globale Lobby-Einstellungen ───────────────────────────────────

  @Get("lobby-settings")
  async getLobbySettings(): Promise<LobbySettings> {
    return this.lobbySettings.getAll();
  }

  @Put("lobby-settings")
  async updateLobbySettings(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(UpdateLobbySettingsDtoSchema)) dto: UpdateLobbySettingsDto
  ): Promise<LobbySettings> {
    await this.lobbySettings.update(req.user!.id, dto);
    return this.lobbySettings.getAll();
  }

  // ─── User-Mgmt ─────────────────────────────────────────────────────

  @Get("users")
  async listUsers(
    @Query(new ZodValidationPipe(ListUsersQuerySchema)) query: ListUsersQuery
  ): Promise<{ users: AdminUserView[] }> {
    const users = await this.admin.listUsers(query);
    return { users };
  }

  @Patch("users/:id/role")
  async setUserRole(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string,
    @Body(new ZodValidationPipe(SetUserRoleDtoSchema)) dto: SetUserRoleDto
  ): Promise<{ ok: true }> {
    await this.admin.setUserRole(req.user!.id, targetId, dto);
    return { ok: true };
  }

  @Patch("users/:id/status")
  async setUserStatus(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string,
    @Body(new ZodValidationPipe(SetUserStatusDtoSchema)) dto: SetUserStatusDto
  ): Promise<{ ok: true }> {
    await this.admin.setUserStatus(req.user!.id, targetId, dto);
    return { ok: true };
  }

  /** Konto freischalten (LAN-Mode): setzt emailVerified=true. */
  @Post("users/:id/approve")
  async approveUser(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string
  ): Promise<{ ok: true }> {
    await this.admin.approveUser(req.user!.id, targetId);
    return { ok: true };
  }

  /** Admin-Notiz pro Nutzer setzen/leeren. */
  @Patch("users/:id/note")
  async setAdminNote(
    @Req() req: FastifyRequest,
    @Param("id") targetId: string,
    @Body(new ZodValidationPipe(SetAdminNoteDtoSchema)) dto: SetAdminNoteDto
  ): Promise<{ ok: true }> {
    await this.admin.setAdminNote(req.user!.id, targetId, dto.note);
    return { ok: true };
  }

  // ─── Audit ─────────────────────────────────────────────────────────

  @Get("audit")
  async listAudit(
    @Query(new ZodValidationPipe(ListAuditQuerySchema)) query: ListAuditQuery
  ): Promise<{ entries: AdminAuditEntry[] }> {
    const entries = await this.admin.listAudit(query);
    return { entries };
  }

  // ─── Quitter-Stats ─────────────────────────────────────────────────

  /**
   * Aggregiert die `game.abandoned`-Audit-Einträge zu einer Top-Quitter-
   * Liste. Spieler mit hohem `withHumans`-Score haben wiederholt echte
   * Mitspieler im Stich gelassen.
   */
  @Get("quitters")
  async listQuitters(@Query("limit") limitRaw?: string): Promise<{ entries: AdminQuitterEntry[] }> {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);
    const entries = await this.admin.listQuitters(limit);
    return { entries };
  }
}
