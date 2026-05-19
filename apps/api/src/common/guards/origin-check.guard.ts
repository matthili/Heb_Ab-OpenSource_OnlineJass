/**
 * **CSRF-Abwehr via Origin-Header.** Globaler Guard auf jedem Request.
 *
 * Warum nicht das im Plan-Doc erwähnte „Double-Submit-Token"?
 *   - Better Auths Session-Cookies sind bereits `SameSite=Lax` (+
 *     HttpOnly + Secure in Prod via Caddy). Das blockt klassische
 *     CSRF-Vektoren (Form-Submit von fremder Origin, `<img src=…>`) bereits.
 *   - Für die verbleibenden Vektoren — JavaScript-Fetch von fremder
 *     Origin mit `credentials: 'include'` — reicht der Server-seitige
 *     **Origin-Header-Check**. Browser senden `Origin` immer mit bei
 *     cross-origin POST/PUT/PATCH/DELETE; falsche Origins setzen lassen
 *     ist im Browser unmöglich (Forbidden Header).
 *   - Double-Submit-Tokens wären reine Belt-and-Suspenders, aber
 *     bringen Komplexität (Token-Generation, Storage, Race-Conditions
 *     bei Token-Rotation). OWASP-Empfehlung 2024+: SameSite + Origin-
 *     Check ist ausreichend, Tokens sind optional.
 *
 * **Regeln:**
 *   - **Safe Methods** (GET, HEAD, OPTIONS): immer durchgelassen — die
 *     ändern keinen Server-State.
 *   - **Mutating Methods** (POST, PUT, PATCH, DELETE):
 *     - Origin-Header muss gesetzt UND in der Trust-Liste sein → 403
 *       bei Verstoß.
 *     - Fehlt Origin komplett: Browser-Anfrage wäre das ungewöhnlich
 *       (passiert nur bei legacy same-origin Form-Posts ohne Origin).
 *       Wir akzeptieren das **nur in Dev**, weil curl/Postman keinen
 *       Origin schicken. In Production: reject.
 *   - **Better-Auth-Routes** (`/api/auth/*`): zusätzlich abgesichert,
 *     weil Better Auth eigene Logik hat — Origin-Check schadet nicht,
 *     ist aber dort schon doppelt geschützt.
 *   - **Health-Check** (`/api/health`): von außen aufgerufen (Loadbalancer,
 *     uptime-monitor), GET-only — fällt eh durch die safe-method-Regel.
 *
 * **Audit**: Jede Ablehnung wird im AuditLog gespeichert; mehrere
 * Rejections aus derselben IP wären ein Indiz für einen automatisierten
 * CSRF-Versuch.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { AuditService } from "../../modules/audit/audit.service.js";
import { isTrustedOrigin } from "../trusted-origins.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class OriginCheckGuard implements CanActivate {
  constructor(private readonly audit: AuditService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Funktioniert nur für HTTP-Kontexte. Bei Socket.IO-Handshakes wird
    // dieser Guard nicht aufgerufen (Gateway-Auth läuft separat über
    // den Cookie-basierten Session-Check im GameGateway).
    if (ctx.getType() !== "http") return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const method = req.method.toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    const origin = (req.headers.origin ?? req.headers["origin"]) as string | undefined;
    const env = process.env["NODE_ENV"] ?? "development";

    if (!origin) {
      // Kein Origin-Header → Browser hat keinen gesetzt (z.B. same-origin
      // Form-Post ohne Origin in alten Browsern) ODER es ist ein
      // server-to-server / curl-Aufruf. In Production: ablehnen.
      // In Dev/Test: durchlassen, sonst kann man die API nicht testen
      // ohne extra Header.
      if (env === "production") {
        await this.recordReject(req, "missing");
        throw new ForbiddenException("Missing Origin header for state-changing request.");
      }
      return true;
    }

    if (!isTrustedOrigin(origin)) {
      await this.recordReject(req, "untrusted", origin);
      throw new ForbiddenException(`Origin ${origin} is not allowed.`);
    }
    return true;
  }

  private async recordReject(
    req: FastifyRequest,
    reason: "missing" | "untrusted",
    origin?: string
  ): Promise<void> {
    try {
      await this.audit.record({
        action: "security.csrf.reject",
        meta: {
          reason,
          ...(origin ? { origin } : {}),
          method: req.method,
          url: req.url,
        },
        ip: req.ip ?? null,
      });
    } catch {
      // Audit darf den Request-Pfad nicht blockieren — schweigen.
    }
  }
}
