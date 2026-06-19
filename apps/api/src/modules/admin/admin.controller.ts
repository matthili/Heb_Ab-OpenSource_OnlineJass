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
import { InferenceClient } from "../inference/inference-client.service.js";
import { LobbyService, type AdminTableView } from "../lobby/lobby.service.js";
import {
  ListReportsQuerySchema,
  SetReportStatusDtoSchema,
  type ListReportsQuery,
  type SetReportStatusDto,
} from "../reports/reports.dto.js";
import { ReportsService, type AdminReportView } from "../reports/reports.service.js";
import { UsernameService, type NameCooldownSettings } from "../users/username.service.js";
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
  UpdateNameCooldownsDtoSchema,
  type AddBannedWordDto,
  type AddBlocklistDto,
  type ListAuditQuery,
  type ListUsersQuery,
  type SetAdminNoteDto,
  type SetUserRoleDto,
  type SetUserStatusDto,
  type SmtpSettingsDto,
  type UpdateLobbySettingsDto,
  type UpdateNameCooldownsDto,
} from "./admin.dto.js";
import {
  AdminService,
  type AdminAuditEntry,
  type AdminQuitterEntry,
  type AdminUserView,
} from "./admin.service.js";
import { SystemStatusService, type SystemStatus } from "./system-status.service.js";

@Controller("api/admin")
@UseGuards(SessionGuard, RolesGuard)
@Roles("ADMIN")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly bannedWords: BannedWordsService,
    private readonly lobbySettings: LobbySettingsService,
    private readonly reports: ReportsService,
    private readonly lobby: LobbyService,
    private readonly inference: InferenceClient,
    private readonly systemStatus: SystemStatusService,
    private readonly username: UsernameService
  ) {}

  // ─── Meldungen (Reports) ───────────────────────────────────────────

  @Get("reports")
  async listReports(
    @Query(new ZodValidationPipe(ListReportsQuerySchema)) query: ListReportsQuery
  ): Promise<{ reports: AdminReportView[] }> {
    const reports = await this.reports.list(query);
    return { reports };
  }

  @Patch("reports/:id/status")
  async setReportStatus(
    @Req() req: FastifyRequest,
    @Param("id") reportId: string,
    @Body(new ZodValidationPipe(SetReportStatusDtoSchema)) dto: SetReportStatusDto
  ): Promise<{ ok: true }> {
    await this.reports.setStatus(req.user!.id, reportId, dto.status);
    return { ok: true };
  }

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
    await this.bannedWords.add(req.user!.id, dto.word, dto.reason ?? null, dto.isRegex ?? false);
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

  // ─── Spielernamen-Cooldowns (Änderung + Freigabe) ──────────────────

  @Get("name-cooldowns")
  async getNameCooldowns(): Promise<NameCooldownSettings> {
    return this.username.getCooldowns();
  }

  @Put("name-cooldowns")
  async updateNameCooldowns(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(UpdateNameCooldownsDtoSchema)) dto: UpdateNameCooldownsDto
  ): Promise<NameCooldownSettings> {
    await this.username.updateCooldowns(req.user!.id, dto);
    return this.username.getCooldowns();
  }

  // ─── Tische (Moderation / Aufräumen) ───────────────────────────────

  /** Alle aktiven (nicht geschlossenen) Tische — für die Admin-Übersicht. */
  @Get("tables")
  async listTables(): Promise<{ tables: AdminTableView[] }> {
    const tables = await this.lobby.listActiveTablesForAdmin();
    return { tables };
  }

  /** Admin löst einen beliebigen Tisch auf (Override). */
  @Post("tables/:id/close")
  async closeTable(
    @Req() req: FastifyRequest,
    @Param("id") tableId: string
  ): Promise<{ tableClosed: boolean }> {
    return this.lobby.closeTableAsAdmin(req.user!.id, tableId);
  }

  // ─── Inferenz-Status (KI-Engine) ───────────────────────────────────

  /**
   * Status des Inferenz-Microservice für die Admin-Anzeige. Macht einen
   * frischen Health-Ping (aktualisiert den gecachten Status im Client) und
   * gibt ihn zurück. `available=false` heißt: NN-Sitze spielen via Heuristik.
   */
  @Get("inference-status")
  async inferenceStatus(): Promise<{
    available: boolean;
    lastCheckedAt: number | null;
    baseUrl: string;
  }> {
    await this.inference.ping();
    return this.inference.getStatus();
  }

  // ─── System-Status (DB / Redis / Migrationen / Modus / Laufzeit) ─────

  /**
   * Aggregierter Betriebsstatus für die Admin-„System-Status"-Seite — gibt
   * Self-Hostern auf einen Blick Auskunft, ob DB + Redis erreichbar sind,
   * Migrationen aktuell, die KI-Engine läuft und in welchem Modus die Instanz
   * fährt (Self-Host/Prod, Captcha, Konto-Freischaltung).
   */
  @Get("system-status")
  async getSystemStatus(): Promise<SystemStatus> {
    return this.systemStatus.getStatus();
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
