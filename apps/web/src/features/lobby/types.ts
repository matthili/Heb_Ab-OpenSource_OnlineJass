/**
 * Frontend-Types für die Lobby — gespiegelt vom Backend
 * (`apps/api/src/modules/lobby/lobby.service.ts`).
 *
 * **Hinweis**: Diese Types sind handgepflegt. In M11 erzeugen wir sie
 * automatisch aus dem OpenAPI-Schema des Backends (`packages/shared-types`),
 * dann ist diese Datei weg. Bis dahin muss sie bei Backend-DTO-Änderungen
 * mitwachsen.
 */

export type LobbyStatus = "WAITING" | "IN_GAME" | "POST_GAME" | "MATCH_OVER" | "CLOSED";
export type JoinMode = "OPEN" | "REQUEST" | "INVITE";
export type RestartMode = "WELI" | "SIEGER_GIBT";
/** Spielart eines Tisches. KREUZ_6P/KREUZ_STEIGERN folgen. */
export type TableVariant = "KREUZ_4P" | "SOLO_4P" | "BODENSEE_2P";

export interface TableListEntry {
  id: string;
  ownerId: string;
  ownerName: string;
  status: LobbyStatus;
  joinMode: JoinMode;
  /** Spielart — "KREUZ_4P" (Team) oder "SOLO_4P" (jeder gegen jeden). */
  variant: TableVariant;
  aiSeatType: string;
  autoFillSeconds: number | null;
  restartMode: RestartMode;
  /** Punkteziel der Partie (kumulativ über alle Spiele). */
  targetScore: number;
  /**
   * Kumulative Punkte je Team über alle bisher beendeten Spiele.
   * Länge 2 bei Kreuz-Jass, 4 bei Solo-Jass (ein Konto je Spieler).
   */
  cumulativeScores: readonly number[];
  seatsTaken: number;
  hasPendingRequest: boolean;
  createdAt: string; // ISO
}

export interface SeatView {
  seat: number;
  user?: { id: string; name: string };
  aiSeatType?: string;
  isEmpty: boolean;
}

export interface TableDetailView extends TableListEntry {
  seats: SeatView[];
  currentGameId: string | null;
  joinRequests?: { id: string; userId: string; userName: string; createdAt: string }[];
  invites?: { id: string; inviteeUserId: string; inviteeName: string; createdAt: string }[];
}

/** DTO für POST /api/lobby/tables. */
export interface OpenTableDto {
  joinMode?: JoinMode;
  variant?: TableVariant;
  aiSeatType?: string;
  autoFillSeconds?: number | null;
  restartMode?: RestartMode;
  /** Punkteziel (500..5000, Default 1000 / bei Solo 500). */
  targetScore?: number;
  initialAiSeats?: { seat: number; aiSeatType?: string }[];
}

/** Antwort von POST /api/lobby/tables/:id/join. */
export type JoinResult =
  | { kind: "seated"; seat: number }
  | { kind: "request-pending"; requestId: string }
  | { kind: "invite-used"; seat: number };
