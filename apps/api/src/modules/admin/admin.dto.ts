/**
 * Zod-DTOs für die Admin-Endpunkte.
 */
import { z } from "zod";

export const SmtpSettingsDtoSchema = z
  .object({
    host: z.string().min(1).max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().max(255).nullable().optional(),
    password: z.string().max(512).nullable().optional(),
    from: z.string().min(1).max(255).optional(),
  })
  .strict();
export type SmtpSettingsDto = z.infer<typeof SmtpSettingsDtoSchema>;

export const AddBlocklistDtoSchema = z
  .object({
    pattern: z
      .string()
      .min(1)
      .max(255)
      .regex(
        /^(@[a-z0-9.-]+|\*?[a-z0-9._@*-]+)$/i,
        "pattern must be '@domain.tld', glob, or literal email"
      ),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type AddBlocklistDto = z.infer<typeof AddBlocklistDtoSchema>;

export const AddBannedWordDtoSchema = z
  .object({
    word: z.string().min(1).max(64).trim(),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type AddBannedWordDto = z.infer<typeof AddBannedWordDtoSchema>;

export const UpdateLobbySettingsDtoSchema = z
  .object({
    /** Hard-Cap auf gleichzeitig aktive Tische (WAITING + IN_GAME + POST_GAME). */
    maxOpenTables: z.number().int().min(1).max(10_000).optional(),
    /** Cap auf Sitzzahl pro Variante (verhindert das Anlegen einer Variante mit mehr Sitzen). */
    maxSeatsPerTable: z.number().int().min(2).max(12).optional(),
    /** Default-Punkte-Ziel, falls der Eröffner kein eigenes targetScore mitgibt. */
    defaultPointsTarget: z.number().int().min(500).max(5000).optional(),
  })
  .strict();
export type UpdateLobbySettingsDto = z.infer<typeof UpdateLobbySettingsDtoSchema>;

export const SetUserRoleDtoSchema = z
  .object({
    role: z.enum(["PLAYER", "MODERATOR", "ADMIN"]),
  })
  .strict();
export type SetUserRoleDto = z.infer<typeof SetUserRoleDtoSchema>;

export const SetUserStatusDtoSchema = z
  .object({
    status: z.enum(["ACTIVE", "BLOCKED"]),
  })
  .strict();
export type SetUserStatusDto = z.infer<typeof SetUserStatusDtoSchema>;

export const ListAuditQuerySchema = z
  .object({
    /** Filter auf Action-Prefix (z.B. "auth." oder "lobby."). */
    actionPrefix: z.string().max(64).optional(),
    actorId: z.string().max(64).optional(),
    /** Pagination: nur Einträge vor diesem ISO-Timestamp. */
    before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export type ListAuditQuery = z.infer<typeof ListAuditQuerySchema>;

export const ListUsersQuerySchema = z
  .object({
    /** Such-Substring auf E-Mail oder Name. */
    q: z.string().max(128).optional(),
    role: z.enum(["PLAYER", "MODERATOR", "ADMIN"]).optional(),
    status: z.enum(["ACTIVE", "BLOCKED", "DELETED_SOFT"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
