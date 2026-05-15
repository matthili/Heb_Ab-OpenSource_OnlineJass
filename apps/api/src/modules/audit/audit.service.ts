/**
 * Audit-Log für sicherheitsrelevante Ereignisse.
 *
 * Schreibt strukturierte Einträge in die `AuditLog`-Tabelle:
 *   - `auth.register.success` | `auth.register.blocked`
 *   - `auth.login.success`    | `auth.login.fail`
 *   - `auth.verify`           | `auth.logout`
 *   - `auth.password_reset.requested` | `.completed`
 *   - `user.block` | `user.role.change` | `admin.setting.update` (kommt in M9)
 *   - `move.cheat_attempt` (kommt in M4, server-side Move-Validation)
 *
 * Wichtige Design-Regel: **Audit-Log darf den Haupt-Flow niemals blockieren.**
 * Schlägt der Insert fehl (DB weg, Disk voll), wird die Exception nur geloggt;
 * die aufrufende Code-Stelle läuft weiter. Andernfalls könnte eine DB-Störung
 * Logins komplett verhindern.
 */
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";

export interface AuditEvent {
  /** Strukturierter Action-Code, z.B. `"auth.login.success"`. */
  action: string;
  /** ID des Users, der die Aktion ausgelöst hat (null für anonyme Versuche). */
  actorId?: string | null;
  /** Optional: ID/Bezeichner des betroffenen Objekts (z.B. blockierter User). */
  target?: string | null;
  /** IP des Aufrufers, sofern bekannt. */
  ip?: string | null;
  /** Frei-Form-Detail (JSON), z.B. `{ email: "...", pattern: "@evil.com" }`. */
  meta?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Schreibt einen Audit-Eintrag — fire-and-forget. Eventuelle DB-Fehler werden
   * geloggt, aber niemals zurückgeworfen.
   */
  async record(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: event.action,
          actorId: event.actorId ?? null,
          target: event.target ?? null,
          ip: event.ip ?? null,
          meta: event.meta ?? {},
        },
      });
    } catch (err) {
      // Niemals werfen — Audit darf den Haupt-Flow nicht killen.
      this.log.error(
        { err, action: event.action, actorId: event.actorId },
        "Audit-Log-Insert fehlgeschlagen"
      );
    }
  }
}
