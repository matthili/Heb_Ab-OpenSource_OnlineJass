/**
 * Erst-Admin-Bootstrap beim API-Start.
 *
 * `OnApplicationBootstrap` läuft, nachdem alle Module initialisiert sind — also
 * mit verbundener Prisma-Connection. Ist `ADMIN_EMAIL` gesetzt und ein User mit
 * dieser Adresse existiert bereits, wird er zum Admin befördert.
 *
 * Den Fall „User registriert sich erst NACH dem Start" deckt der Hook in
 * `AuthService` ab (Beförderung direkt bei der Registrierung). Zusammen gilt:
 * egal ob der Account vor oder nach dem Setzen von `ADMIN_EMAIL` entsteht — er
 * wird Admin, ohne rohes SQL.
 */
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ADMIN_BOOTSTRAP_ACTION, promoteConfiguredAdminEmail } from "./admin-bootstrap.util.js";

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const result = await promoteConfiguredAdminEmail(this.prisma);
    switch (result.kind) {
      case "no-email-configured":
        // Kein ADMIN_EMAIL gesetzt — kein Auto-Admin gewünscht, kein Log-Spam.
        return;
      case "user-not-found":
        this.log.log(
          `ADMIN_EMAIL=${result.email} gesetzt, aber noch kein User mit dieser Adresse. ` +
            `Sobald er sich registriert, wird er automatisch Admin.`
        );
        return;
      case "already-admin":
        this.log.debug(`ADMIN_EMAIL=${result.email} ist bereits Admin — nichts zu tun.`);
        return;
      case "promoted":
        this.log.log(
          `ADMIN_EMAIL=${result.email}: User ${result.userId} wurde beim Start zum Admin befördert.`
        );
        await this.audit.record({
          action: ADMIN_BOOTSTRAP_ACTION,
          target: result.userId,
          meta: {
            email: result.email,
            via: "ADMIN_EMAIL",
            source: "startup",
            previousRole: result.previousRole,
          },
        });
        return;
    }
  }
}
