/**
 * Rollen-Guard. Wird hinter `SessionGuard` aufgesetzt (= `req.user` ist
 * sicher) und prüft die DB-User.role gegen die vom `@Roles(...)`-Decorator
 * vorgegebenen Required-Roles.
 *
 * **Konsultation der DB statt Token-Claim**: Better Auth hat keine
 * eingebauten Custom-Claims, und wir wollen ohnehin, dass eine
 * Rollen-Aberkennung sofort wirkt (Admin geht raus → kein nächster
 * Request klappt). DB-Lookup pro Admin-Request ist akzeptabel — das
 * sind keine Hot-Paths.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import type { FastifyRequest } from "fastify";

import { PrismaService } from "../../modules/prisma/prisma.service.js";
import { ROLES_KEY } from "../decorators/roles.decorator.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true; // ohne @Roles → frei

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.user?.id) {
      // SessionGuard sollte vorher gelaufen sein; defensive falls verdreht.
      throw new UnauthorizedException("Not signed in");
    }
    const dbUser = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, status: true },
    });
    if (!dbUser) {
      throw new UnauthorizedException("User not found");
    }
    if (dbUser.status !== "ACTIVE") {
      throw new ForbiddenException("Account is not active");
    }
    if (!required.includes(dbUser.role)) {
      throw new ForbiddenException(
        `Required role: ${required.join(" or ")}; you have: ${dbUser.role}`
      );
    }
    return true;
  }
}
