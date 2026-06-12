/**
 * Profil-Lese- und Schreibmethoden.
 *
 * Liest Identität (User-Core) + Profile zusammen und maskiert pro Feld nach
 * der Vier-Stufen-Sichtbarkeit. Schreiben passiert nur durch den User selbst.
 *
 * Nicht im Scope dieses Service:
 *   - Authentifizierung (das macht der AuthGuard via Better-Auth-Session)
 *   - Anlegen des Profile-Records: passiert lazy beim ersten Update.
 *   - Email-Adresse oder Spitzname (`name`) ändern: das geht über Better Auths
 *     `/update-user`-Endpunkt direkt, weil dort spezifische Verify-/Konflikt-
 *     Logiken nötig sind, die wir nicht duplizieren wollen.
 */
import { Injectable, NotFoundException } from "@nestjs/common";
import type { Profile, User } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";
import { UserStatsService, type UserStats } from "./user-stats.service.js";
import {
  DEFAULT_VISIBILITY,
  PRESENCE_VISIBILITY_KEY,
  STATS_VISIBILITY_KEY,
  VISIBLE_PROFILE_FIELDS,
  type ConfigurableVisibilityKey,
  type ProfileFieldName,
  type VisibilityLevel,
  type VisibilityMap,
  type ViewerContext,
  canSeeField,
  resolvePresenceVisibility,
  resolveStatsVisibility,
  resolveVisibility,
} from "./visibility.js";

export interface UpdateProfileInput {
  realFirstName?: string | null | undefined;
  realLastName?: string | null | undefined;
  birthDate?: Date | null | undefined;
  city?: string | null | undefined;
  country?: string | null | undefined;
  hobbies?: string | null | undefined;
  bio?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  visibility?: VisibilityMap | undefined;
  publicLeaderboard?: boolean | undefined;
  dmPolicy?: "ALL" | "FRIENDS" | undefined;
}

/** Antwort von getMyProfile — voller Eigenblick. */
export interface MyProfileView {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  role: string;
  status: string;
  locale: string;
  createdAt: Date;
  profile: {
    realFirstName: string | null;
    realLastName: string | null;
    birthDate: Date | null;
    city: string | null;
    country: string | null;
    hobbies: string | null;
    bio: string | null;
    avatarUrl: string | null;
    visibility: Readonly<Record<ConfigurableVisibilityKey, VisibilityLevel>>;
    publicLeaderboard: boolean;
    dmPolicy: "ALL" | "FRIENDS";
  };
}

/**
 * Antwort von getPublicProfile — gefiltert nach Visibility. Nur die Felder,
 * die der Viewer sehen darf, sind gesetzt; alle anderen sind null.
 *
 * `name` (Spitzname) ist immer öffentlich — gehört zur User-Identity, nicht
 * zum Profil, und wird per Plan-Spec niemals versteckt.
 */
export interface PublicProfileView {
  id: string;
  name: string;
  // Optional je nach Visibility:
  realFirstName: string | null;
  realLastName: string | null;
  birthDate: Date | null;
  city: string | null;
  country: string | null;
  hobbies: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** Spiel-Statistik — nur gesetzt, wenn die `stats`-Visibility es dem Viewer erlaubt. */
  stats: UserStats | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userStats: UserStatsService
  ) {}

  async getMyProfile(userId: string): Promise<MyProfileView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException("User not found");
    return shapeMyProfile(user, user.profile);
  }

  async getPublicProfile(viewerId: string | null, targetId: string): Promise<PublicProfileView> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      include: { profile: true },
    });
    if (!user || user.status !== "ACTIVE") {
      throw new NotFoundException("User not found");
    }
    const ctx: ViewerContext = {
      viewerId,
      isSelf: viewerId === targetId,
      areFriends: viewerId !== null ? await this.areFriends(viewerId, targetId) : false,
    };
    const base = shapePublicProfile(user, user.profile, ctx);
    // Statistik nur laden + ausliefern, wenn die `stats`-Sichtbarkeit es dem
    // Viewer erlaubt (gleiche 4 Stufen wie die Profil-Felder).
    const vis = (user.profile?.visibility ?? {}) as VisibilityMap;
    const stats = canSeeField(resolveStatsVisibility(vis), ctx)
      ? await this.userStats.getStats(targetId)
      : null;
    return { ...base, stats };
  }

  async updateMyProfile(userId: string, input: UpdateProfileInput): Promise<MyProfileView> {
    // Upsert: Profile-Record existiert ggf. noch nicht. Wir mergen
    // bestehende Visibility mit dem Update.
    const existing = await this.prisma.profile.findUnique({ where: { userId } });
    const mergedVisibility: VisibilityMap = {
      ...((existing?.visibility ?? {}) as VisibilityMap),
      ...(input.visibility ?? {}),
    };

    // Unter-16-Schutz für PN-Empfangsrechte: Trifft der User in diesem Vorgang
    // keine explizite dmPolicy-Wahl (Feld nicht mitgesendet) und ergibt das
    // effektive Geburtsdatum ein Alter < 16, defaulten wir auf „nur Freunde".
    // Eine explizite Wahl (auch „ALL") gewinnt immer und bleibt änderbar — das
    // Edit-Panel sendet dmPolicy stets mit, daher wird nichts überschrieben.
    const effectiveBirthDate =
      input.birthDate !== undefined ? input.birthDate : (existing?.birthDate ?? null);
    let dmPolicy = input.dmPolicy;
    if (dmPolicy === undefined && effectiveBirthDate && isUnder16(effectiveBirthDate)) {
      dmPolicy = "FRIENDS";
    }

    await this.prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        realFirstName: input.realFirstName ?? null,
        realLastName: input.realLastName ?? null,
        birthDate: input.birthDate ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        hobbies: input.hobbies ?? null,
        bio: input.bio ?? null,
        avatarUrl: input.avatarUrl ?? null,
        visibility: mergedVisibility,
        ...(input.publicLeaderboard !== undefined && {
          publicLeaderboard: input.publicLeaderboard,
        }),
        ...(dmPolicy !== undefined && { dmPolicy }),
      },
      update: {
        ...(input.realFirstName !== undefined && { realFirstName: input.realFirstName }),
        ...(input.realLastName !== undefined && { realLastName: input.realLastName }),
        ...(input.birthDate !== undefined && { birthDate: input.birthDate }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.country !== undefined && { country: input.country }),
        ...(input.hobbies !== undefined && { hobbies: input.hobbies }),
        ...(input.bio !== undefined && { bio: input.bio }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
        visibility: mergedVisibility,
        ...(input.publicLeaderboard !== undefined && {
          publicLeaderboard: input.publicLeaderboard,
        }),
        ...(dmPolicy !== undefined && { dmPolicy }),
      },
    });

    return this.getMyProfile(userId);
  }

  private async areFriends(userA: string, userB: string): Promise<boolean> {
    if (userA === userB) return false; // sinnlos
    // Eine Freundschaft existiert in genau einer Richtung — wir prüfen beide.
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: userA, addresseeId: userB },
          { requesterId: userB, addresseeId: userA },
        ],
      },
    });
    return friendship !== null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Shaper-Funktionen (rein, ohne Side-Effects — testbar)
// ────────────────────────────────────────────────────────────────────

function shapeMyProfile(user: User, profile: Profile | null): MyProfileView {
  const userVisibility = (profile?.visibility ?? {}) as VisibilityMap;
  const visibility: Record<ConfigurableVisibilityKey, VisibilityLevel> = {
    ...DEFAULT_VISIBILITY,
    [STATS_VISIBILITY_KEY]: resolveStatsVisibility(userVisibility),
    [PRESENCE_VISIBILITY_KEY]: resolvePresenceVisibility(userVisibility),
  };
  for (const f of VISIBLE_PROFILE_FIELDS) {
    visibility[f] = resolveVisibility(f, userVisibility);
  }
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    role: user.role,
    status: user.status,
    locale: user.locale,
    createdAt: user.createdAt,
    profile: {
      realFirstName: profile?.realFirstName ?? null,
      realLastName: profile?.realLastName ?? null,
      birthDate: profile?.birthDate ?? null,
      city: profile?.city ?? null,
      country: profile?.country ?? null,
      hobbies: profile?.hobbies ?? null,
      bio: profile?.bio ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      visibility,
      publicLeaderboard: profile?.publicLeaderboard ?? false,
      dmPolicy: profile?.dmPolicy ?? "ALL",
    },
  };
}

/**
 * Ist die Person am Stichtag „heute" jünger als 16? Vergleich über das
 * 16-Jahres-Datum, damit Monats-/Tagesgrenzen und Schaltjahre korrekt sitzen.
 */
function isUnder16(birthDate: Date): boolean {
  const sixteenth = new Date(birthDate);
  sixteenth.setFullYear(sixteenth.getFullYear() + 16);
  return sixteenth.getTime() > Date.now();
}

/**
 * Maskiert ein fremdes Profil basierend auf den Visibility-Stufen.
 * Pure function: keine DB-Zugriffe, alle Daten sind als Argumente da.
 * Damit lässt sich der Filter direkt mit Unit-Tests abdecken.
 */
export function shapePublicProfile(
  user: User,
  profile: Profile | null,
  ctx: ViewerContext
): PublicProfileView {
  const userVisibility = (profile?.visibility ?? {}) as VisibilityMap;

  const pick = <T>(field: ProfileFieldName, value: T | null | undefined): T | null => {
    const level = resolveVisibility(field, userVisibility);
    if (!canSeeField(level, ctx)) return null;
    return (value ?? null) as T | null;
  };

  return {
    id: user.id,
    name: user.name, // Spitzname ist per Plan immer öffentlich.
    realFirstName: pick("realFirstName", profile?.realFirstName),
    realLastName: pick("realLastName", profile?.realLastName),
    birthDate: pick("birthDate", profile?.birthDate),
    city: pick("city", profile?.city),
    country: pick("country", profile?.country),
    hobbies: pick("hobbies", profile?.hobbies),
    bio: pick("bio", profile?.bio),
    avatarUrl: pick("avatarUrl", profile?.avatarUrl),
    // Statistik füllt `getPublicProfile` nach (async, gated). Pure-Shaper: null.
    stats: null,
  };
}
