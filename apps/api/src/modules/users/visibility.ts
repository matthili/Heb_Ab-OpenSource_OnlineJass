/**
 * Vier-Stufen-Sichtbarkeit pro Profil-Feld.
 *
 * Definition aus dem Plan:
 *   PUBLIC     — sichtbar für alle (auch nicht eingeloggt)
 *   LOGGED_IN  — sichtbar für jeden eingeloggten Nutzer
 *   FRIENDS    — sichtbar nur für bestätigte Freunde (Friendship.status=ACCEPTED)
 *   PRIVATE    — sichtbar nur für den User selbst
 *
 * Die Visibility wird als JSONB-Map im `Profile.visibility`-Feld gespeichert:
 *   { realFirstName: "FRIENDS", city: "PUBLIC", ... }
 *
 * Felder, die nicht in der Map vorkommen, fallen auf die Defaults zurück
 * (siehe DEFAULT_VISIBILITY).
 */
import { z } from "zod";

export const VISIBILITY_LEVELS = ["PUBLIC", "LOGGED_IN", "FRIENDS", "PRIVATE"] as const;
export type VisibilityLevel = (typeof VISIBILITY_LEVELS)[number];

export const VisibilityLevelSchema = z.enum(VISIBILITY_LEVELS);

/** Die Profil-Felder, deren Sichtbarkeit konfigurierbar ist. */
export const VISIBLE_PROFILE_FIELDS = [
  "realFirstName",
  "realLastName",
  "birthDate",
  "city",
  "country",
  "hobbies",
  "bio",
  "avatarUrl",
] as const;
export type ProfileFieldName = (typeof VISIBLE_PROFILE_FIELDS)[number];

/**
 * Sinnvolle Defaults, falls der User keine Visibility gesetzt hat.
 * Konservativ: optionale Identitäts-Felder sind initial nur für eingeloggte
 * Nutzer sichtbar (nicht öffentlich indexierbar), aber auch nicht nur für
 * Freunde — das wäre als Default zu restriktiv.
 */
export const DEFAULT_VISIBILITY: Readonly<Record<ProfileFieldName, VisibilityLevel>> = {
  realFirstName: "LOGGED_IN",
  realLastName: "LOGGED_IN",
  birthDate: "LOGGED_IN",
  city: "LOGGED_IN",
  country: "LOGGED_IN",
  hobbies: "LOGGED_IN",
  bio: "PUBLIC",
  avatarUrl: "PUBLIC",
};

/**
 * Pseudo-Feld „stats": steuert, wer die Spiel-Statistik (Partien, Siege,
 * Siegesrate, Ø-Punkte je Variante) im öffentlichen Profil sieht. Wird in
 * derselben `visibility`-Map gespeichert wie die Profil-Felder, ist aber KEIN
 * Profil-DB-Feld (daher separat von `VISIBLE_PROFILE_FIELDS`).
 */
export const STATS_VISIBILITY_KEY = "stats" as const;
export const DEFAULT_STATS_VISIBILITY: VisibilityLevel = "LOGGED_IN";

/**
 * Pseudo-Feld „presence": steuert, wer den Online-/Zuletzt-gesehen-Status
 * sieht (Präsenzliste + Online-Punkt). Sinnvoll sind nur drei der vier Stufen:
 *   PRIVATE   — niemand (außer dem User selbst)
 *   FRIENDS   — nur bestätigte Freunde
 *   LOGGED_IN — alle eingeloggten User
 * PUBLIC ergibt für Präsenz keinen Sinn und wird wie LOGGED_IN behandelt.
 */
export const PRESENCE_VISIBILITY_KEY = "presence" as const;
export const DEFAULT_PRESENCE_VISIBILITY: VisibilityLevel = "LOGGED_IN";

/** Alle konfigurierbaren Visibility-Schlüssel: Profil-Felder + `stats` + `presence`. */
export const CONFIGURABLE_VISIBILITY_KEYS = [
  ...VISIBLE_PROFILE_FIELDS,
  STATS_VISIBILITY_KEY,
  PRESENCE_VISIBILITY_KEY,
] as const;
export type ConfigurableVisibilityKey = (typeof CONFIGURABLE_VISIBILITY_KEYS)[number];

export const VisibilityMapSchema = z.partialRecord(
  z.enum(CONFIGURABLE_VISIBILITY_KEYS),
  VisibilityLevelSchema
);
export type VisibilityMap = z.infer<typeof VisibilityMapSchema>;

/** Resolved Visibility für die Statistik (`stats`-Pseudo-Feld). */
export function resolveStatsVisibility(
  userVisibility: VisibilityMap | null | undefined
): VisibilityLevel {
  return userVisibility?.[STATS_VISIBILITY_KEY] ?? DEFAULT_STATS_VISIBILITY;
}

/** Resolved Visibility für die Präsenz (`presence`-Pseudo-Feld). */
export function resolvePresenceVisibility(
  userVisibility: VisibilityMap | null | undefined
): VisibilityLevel {
  return userVisibility?.[PRESENCE_VISIBILITY_KEY] ?? DEFAULT_PRESENCE_VISIBILITY;
}

export interface ViewerContext {
  /** User-ID des Anfragers; null = anonym (nicht eingeloggt). */
  viewerId: string | null;
  /** Ob viewer und target eine ACCEPTED-Freundschaft haben. */
  areFriends: boolean;
  /** Ob viewer == target (Self-View). */
  isSelf: boolean;
}

/**
 * Entscheidet, ob ein Feld dem Anfrager gezeigt werden darf.
 * Hierarchie:  PUBLIC ≥ LOGGED_IN ≥ FRIENDS ≥ PRIVATE.
 */
export function canSeeField(level: VisibilityLevel, ctx: ViewerContext): boolean {
  if (ctx.isSelf) return true; // Self sieht alles.
  switch (level) {
    case "PUBLIC":
      return true;
    case "LOGGED_IN":
      return ctx.viewerId !== null;
    case "FRIENDS":
      return ctx.viewerId !== null && ctx.areFriends;
    case "PRIVATE":
      return false;
  }
}

/**
 * Resolved Visibility für ein einzelnes Feld — nutzt den User-Wert wenn vorhanden,
 * sonst den Default.
 */
export function resolveVisibility(
  field: ProfileFieldName,
  userVisibility: VisibilityMap | null | undefined
): VisibilityLevel {
  return userVisibility?.[field] ?? DEFAULT_VISIBILITY[field];
}
