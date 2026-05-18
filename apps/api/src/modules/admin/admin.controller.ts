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
import {
  AddBlocklistDtoSchema,
  ListAuditQuerySchema,
  ListUsersQuerySchema,
  SetUserRoleDtoSchema,
  SetUserStatusDtoSchema,
  SmtpSettingsDtoSchema,
  type AddBlocklistDto,
  type ListAuditQuery,
  type ListUsersQuery,
  type SetUserRoleDto,
  type SetUserStatusDto,
  type SmtpSettingsDto,
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
  constructor(private readonly admin: AdminService) {}

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
