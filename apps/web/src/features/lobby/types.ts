/**
 * Frontend-Types für die Lobby.
 *
 * **Seit D14 (2026-05-26)** kommen die Typen aus `@jass/shared-types` —
 * inferiert per `z.infer` aus den geteilten Zod-Schemas. Das Backend ist
 * dieselbe Quelle, also kein hand-pflegen-Drift mehr.
 */
export type {
  LobbyStatus,
  JoinMode,
  RestartMode,
  WinMode,
  VariantEnum as TableVariant,
  TableListEntry,
  SeatView,
  TableDetailView,
  OpenTableDto,
  JoinResult,
} from "@jass/shared-types";
