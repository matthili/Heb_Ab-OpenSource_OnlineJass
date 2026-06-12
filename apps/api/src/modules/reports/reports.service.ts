/**
 * User-Meldungen (Moderation). Ein User meldet einen anderen mit Kontext
 * (Profil/Chat/Spielverhalten) + Grund. Admins sehen + bearbeiten die Liste.
 */
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { ListReportsQuery, ReportStatusValue, ReportUserDto } from "./reports.dto.js";

export interface AdminReportView {
  id: string;
  reporterId: string;
  reporterName: string;
  reportedUserId: string;
  reportedUserName: string;
  context: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /** Erzeugt eine Meldung. Selbst-Meldung + unbekanntes Ziel werden abgelehnt. */
  async create(
    reporterId: string,
    reportedUserId: string,
    dto: ReportUserDto
  ): Promise<{ id: string }> {
    if (reporterId === reportedUserId) {
      throw new BadRequestException("Du kannst dich nicht selbst melden.");
    }
    const target = await this.prisma.user.findUnique({
      where: { id: reportedUserId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException("Gemeldeter User nicht gefunden.");

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedUserId,
        context: dto.context,
        reason: dto.reason,
        ...(dto.note ? { note: dto.note } : {}),
      },
      select: { id: true },
    });
    await this.audit.record({
      action: "user.report",
      actorId: reporterId,
      target: reportedUserId,
      meta: { reportId: report.id, context: dto.context, reason: dto.reason },
    });
    return { id: report.id };
  }

  /** Admin-Liste — neueste zuerst, optional nach Status gefiltert. */
  async list(query: ListReportsQuery): Promise<AdminReportView[]> {
    const rows = await this.prisma.report.findMany({
      where: query.status ? { status: query.status } : {},
      include: {
        reporter: { select: { name: true } },
        reportedUser: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      skip: query.offset,
    });
    return rows.map((r) => ({
      id: r.id,
      reporterId: r.reporterId,
      reporterName: r.reporter.name,
      reportedUserId: r.reportedUserId,
      reportedUserName: r.reportedUser.name,
      context: r.context,
      reason: r.reason,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
  }

  /** Admin setzt den Bearbeitungs-Status. PENDING = wieder offen. */
  async setStatus(adminId: string, reportId: string, status: ReportStatusValue): Promise<void> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true },
    });
    if (!report) throw new NotFoundException("Meldung nicht gefunden.");
    const resolved = status !== "PENDING";
    await this.prisma.report.update({
      where: { id: reportId },
      data: resolved
        ? { status, resolvedAt: new Date(), resolvedById: adminId }
        : { status, resolvedAt: null, resolvedById: null },
    });
    await this.audit.record({
      action: "admin.report.status",
      actorId: adminId,
      target: reportId,
      meta: { status },
    });
  }
}
