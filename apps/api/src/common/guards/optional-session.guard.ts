/**
 * Wie SessionGuard, aber lässt anonyme Anfragen durch.
 *
 * Verwendung: Endpunkte, die public-readable sind (z.B. `/api/users/:id`),
 * deren Antwort sich aber je nach Login-Status unterscheidet (Visibility-
 * Stufen LOGGED_IN / FRIENDS).
 */
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { AuthService } from "../../modules/auth/auth.service.js";
import type { SessionUser } from "./session.guard.js";

@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else {
        headers.set(k, String(v));
      }
    }
    try {
      const result = (await this.auth.auth.api.getSession({ headers })) as {
        session: { id: string; userId: string; expiresAt: Date };
        user: SessionUser;
      } | null;
      if (result?.session && result.user) {
        req.session = result.session;
        req.user = result.user;
      }
    } catch {
      // Session-Lookup-Fehler werden hier ignoriert — der Endpoint behandelt
      // einen anonymen Zugriff korrekt.
    }
    return true;
  }
}
