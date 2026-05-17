/**
 * `@Roles(...)` markiert einen Controller oder eine Handler-Methode mit
 * der Liste der zugelassenen Rollen. Der `RolesGuard` liest das Metadata
 * via Reflector und gleicht gegen die DB-User.role ab.
 *
 * Beispiel:
 *   @Post("/admin/blocklist")
 *   @UseGuards(SessionGuard, RolesGuard)
 *   @Roles("ADMIN")
 *   addPattern(...) { ... }
 */
import { SetMetadata } from "@nestjs/common";
import type { Role } from "@prisma/client";

export const ROLES_KEY = "jass.roles";

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
