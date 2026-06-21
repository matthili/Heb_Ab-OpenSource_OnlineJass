/**
 * Frontend-Types für Admin (gespiegelt vom Backend).
 */
export type Role = "PLAYER" | "MODERATOR" | "ADMIN";
export type UserStatus = "ACTIVE" | "BLOCKED" | "DELETED_SOFT";

/** Aggregierter Betriebsstatus (Admin → System-Status). Spiegelt das Backend. */
export interface SystemStatus {
  db: { ok: boolean };
  migrations: { applied: number; latest: string | null; latestAt: string | null };
  redis: { ok: boolean };
  inference: { available: boolean; lastCheckedAt: number | null; baseUrl: string };
  smtp: { host: string; port: number; ok: boolean };
  landing: { url: string | null; ok: boolean | null };
  mode: {
    nodeEnv: string;
    selfHost: boolean;
    accountActivation: string;
    captchaEnabled: boolean;
  };
  runtime: { nodeVersion: string; uptimeSeconds: number };
  checkedAt: string;
}

export interface SmtpSettingsView {
  host?: string;
  port?: number;
  user?: string | null;
  from?: string;
  /** true = No-Reply-Adresse (Antworten werden verworfen). Default true. */
  noReply?: boolean;
  hasPassword: boolean;
}

export interface BlocklistEntry {
  pattern: string;
  reason: string | null;
  createdAt: string;
}

export interface BannedWordEntry {
  word: string;
  reason: string | null;
  isRegex: boolean;
  createdAt: string;
}

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  /** `false` = wartet auf Freischaltung (E-Mail-Link oder Admin im LAN-Mode). */
  emailVerified: boolean;
  /** Admin-Notiz (z.B. „Rookie3000 = Martin Meier"). */
  adminNote: string | null;
  createdAt: string;
}

export interface AdminAuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  target: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
}

export interface MeProfileResponse {
  id: string;
  email: string;
  name: string;
  role: Role;
}
