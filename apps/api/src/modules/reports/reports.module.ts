import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { ReportsService } from "./reports.service.js";

/**
 * Stellt `ReportsService` bereit (Erstellen via UsersController, Review via
 * AdminController). PrismaService ist global; AuditModule wird importiert.
 */
@Module({
  imports: [AuditModule],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
