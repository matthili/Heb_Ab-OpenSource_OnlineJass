/**
 * Frontend-Types für Admin (gespiegelt vom Backend).
 */
export type Role = "PLAYER" | "MODERATOR" | "ADMIN";
export type UserStatus = "ACTIVE" | "BLOCKED" | "DELETED_SOFT";

export interface SmtpSettingsView {
  host?: string;
  port?: number;
  user?: string | null;
  from?: string;
  hasPassword: boolean;
}

export interface BlocklistEntry {
  pattern: string;
  reason: string | null;
  createdAt: string;
}

export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
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
