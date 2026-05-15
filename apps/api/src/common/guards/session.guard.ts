/**
 * AuthGuard, der Better-Auth-Sessions aus dem Request-Cookie liest.
 *
 * Bei jedem geschützten Endpunkt:
 *   1. Request-Headers an `auth.api.getSession({ headers })` reichen.
 *   2. Bei gültiger Session: Session + User auf `req.session` und `req.user` hängen.
 *   3. Bei keiner Session: 401 Unauthorized.
 *
 * Performance: Better Auth hat in der Config einen `cookieCache` aktiviert
 * (5 min lokal), sodass nicht jeder Request einen DB-Lookup auslöst.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { AuthService } from "../../modules/auth/auth.service.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    session?: { id: string; userId: string; expiresAt: Date };
    user?: SessionUser;
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();

    // Fastify-Headers → Web-Headers für Better Auth.
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else {
        headers.set(k, String(v));
      }
    }

    const result = (await this.auth.auth.api.getSession({ headers })) as {
      session: { id: string; userId: string; expiresAt: Date };
      user: SessionUser;
    } | null;
    if (!result?.session || !result.user) {
      throw new UnauthorizedException("Not signed in");
    }
    req.session = result.session;
    req.user = result.user;
    return true;
  }
}
