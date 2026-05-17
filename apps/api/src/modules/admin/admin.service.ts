/**
 * Admin-Service. Sammelt alle Aktionen, die nur Admins ausführen dürfen:
 *   - SMTP-Settings lesen/setzen (verschlüsseltes Passwort)
 *   - Blocklist CRUD
 *   - User-Mgmt: Listen, Rolle setzen, Block/Unblock
 *   - Audit-Log anzeigen
 *
 * Jede Aktion landet selbst im Audit-Log — wichtig, weil Admin-Aktionen
 * potentes Material sind (Plan-Doc Sicherheits-Checkliste #9).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, Role, UserStatus } from "@prisma/client";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  AddBlocklistDto,
  ListAuditQuery,
  ListUsersQuery,
  SetUserRoleDto,
  SetUserStatusDto,
  SmtpSettingsDto,
} from "./admin.dto.js";
import { SmtpSettingsService, type SmtpSettings } from "../mail/smtp-settings.service.js";

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
}

export interface AdminAuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  target: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly smtp: SmtpSettingsService
  ) {}

  // ─── SMTP ──────────────────────────────────────────────────────────

  /**
   * Aktuelle SMTP-Settings — Passwort wird NICHT zurückgegeben (auch
   * Admins sehen es nie im Klartext). Stattdessen ein Flag, ob ein
   * Passwort gesetzt ist.
   */
  async getSmtp(): Promise<Omit<Partial<SmtpSettings>, "password"> & { hasPassword: boolean }> {
    const s = await this.smtp.get();
    const { password, ...rest } = s;
    return { ...rest, hasPassword: typeof password === "string" && password.length > 0 };
  }

  async updateSmtp(actorId: string, dto: SmtpSettingsDto): Promise<void> {
    await this.smtp.update(actorId, dto);
    await this.audit.record({
      action: "admin.smtp.update",
      actorId,
      meta: {
        changed: Object.keys(dto).filter((k) => k !== "password"),
        passwordChanged: dto.password !== undefined,
      },
    });
  }

  // ─── Blocklist ─────────────────────────────────────────────────────

  async listBlocklist(): Promise<{ pattern: string; reason: string | null; createdAt: string }[]> {
    const rows = await this.prisma.blocklist.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      pattern: r.pattern,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addBlocklistPattern(actorId: string, dto: AddBlocklistDto): Promise<void> {
    const existing = await this.prisma.blocklist.findUnique({ where: { pattern: dto.pattern } });
    if (existing) {
      throw new ConflictException(`Pattern '${dto.pattern}' existiert bereits.`);
    }
    await this.prisma.blocklist.create({
      data: { pattern: dto.pattern, ...(dto.reason ? { reason: dto.reason } : {}) },
    });
    await this.audit.record({
      action: "admin.blocklist.add",
      actorId,
      target: dto.pattern,
      meta: { reason: dto.reason ?? null },
    });
  }

  async removeBlocklistPattern(actorId: string, pattern: string): Promise<void> {
    const removed = await this.prisma.blocklist.delete({ where: { pattern } }).catch(() => null);
    if (!removed) throw new NotFoundException(`Pattern '${pattern}' nicht gefunden`);
    await this.audit.record({
      action: "admin.blocklist.remove",
      actorId,
      target: pattern,
    });
  }

  // ─── User-Mgmt ─────────────────────────────────────────────────────

  async listUsers(query: ListUsersQuery): Promise<AdminUserView[]> {
    const where: Prisma.UserWhereInput = {};
    if (query.q) {
      where.OR = [
        { email: { contains: query.q, mode: "insensitive" } },
        { name: { contains: query.q, mode: "insensitive" } },
      ];
    }
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        emailVerified: true,
        createdAt: true,
      },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async setUserRole(actorId: string, targetId: string, dto: SetUserRoleDto): Promise<void> {
    if (actorId === targetId && dto.role !== "ADMIN") {
      // Schutz vor versehentlichem Self-Demote — sonst wäre der letzte
      // Admin gleich kein Admin mehr.
      throw new BadRequestException("Admins dürfen sich nicht selbst degradieren.");
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true },
    });
    if (!target) throw new NotFoundException(`User ${targetId} nicht gefunden`);
    await this.prisma.user.update({
      where: { id: targetId },
      data: { role: dto.role },
    });
    await this.audit.record({
      action: "admin.user.role",
      actorId,
      target: targetId,
      meta: { from: target.role, to: dto.role },
    });
  }

  async setUserStatus(actorId: string, targetId: string, dto: SetUserStatusDto): Promise<void> {
    if (actorId === targetId) {
      throw new BadRequestException("Du kannst deinen eigenen Status nicht ändern.");
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { status: true },
    });
    if (!target) throw new NotFoundException(`User ${targetId} nicht gefunden`);
    await this.prisma.user.update({
      where: { id: targetId },
      data: { status: dto.status },
    });
    if (dto.status === "BLOCKED") {
      // Aktive Sessions des blockierten Users invalidieren — sonst läuft
      // er noch bis zum Cookie-Cache-Refresh weiter rum.
      await this.prisma.session.deleteMany({ where: { userId: targetId } });
    }
    await this.audit.record({
      action: "admin.user.status",
      actorId,
      target: targetId,
      meta: { from: target.status, to: dto.status },
    });
  }

  // ─── Audit-Log-View ────────────────────────────────────────────────

  async listAudit(query: ListAuditQuery): Promise<AdminAuditEntry[]> {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.actionPrefix) where.action = { startsWith: query.actionPrefix };
    if (query.actorId) where.actorId = query.actorId;
    if (query.before) where.createdAt = { lt: new Date(query.before) };

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      include: { actor: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      actorId: r.actorId,
      actorName: r.actor?.name ?? null,
      action: r.action,
      target: r.target,
      meta: r.meta,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
