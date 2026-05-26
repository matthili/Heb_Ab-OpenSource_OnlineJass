/**
 * Lobby-DTOs.
 *
 * **Seit D14 (2026-05-26)** liegen die Zod-Schemas in
 * `@jass/shared-types/contracts/lobby` — das Frontend importiert dieselbe
 * Quelle. Dieses Re-Export-File hält alle bestehenden Backend-Imports
 * funktional (`./lobby.dto.js`), ohne dass irgendwo ein Pfad-Refactor nötig
 * wäre.
 */
export {
  AiSeatTypeSchema,
  JoinModeSchema,
  RestartModeSchema,
  VariantEnumSchema,
  LobbyStatusSchema,
  OpenTableDtoSchema,
  UpdateTableSettingsDtoSchema,
  InviteUserDtoSchema,
  RematchVoteDtoSchema,
  ListTablesQuerySchema,
  type JoinMode,
  type RestartMode,
  type VariantEnum,
  type LobbyStatus,
  type OpenTableDto,
  type UpdateTableSettingsDto,
  type InviteUserDto,
  type RematchVoteDto,
  type ListTablesQuery,
} from "@jass/shared-types";
