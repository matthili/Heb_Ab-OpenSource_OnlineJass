/**
 * Anwesenheits-Liste der Lobby.
 *
 * „Online" heißt: ein User hat mindestens einen aktiven WS-Socket — egal ob
 * er gerade auf der Lobby-Seite steht, am Spieltisch sitzt oder den
 * Profil-Editor offen hat. Diese Pragmatik kommt aus der Spec
 * („Online-Liste mit Spitznamen") und entspricht dem typischen Chat-Verhalten
 * (Online-Indikator zählt App-weit, nicht pro Seite).
 *
 * Quelle der Wahrheit für „aktiver Socket" ist die `PerUserSocketRegistry`
 * (Redis-Set pro User mit Socket-IDs); fehlt der User dort, ist er offline.
 */
import { Injectable } from "@nestjs/common";

import { PerUserSocketRegistry } from "../game/per-user-socket-registry.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { resolvePresenceVisibility, type VisibilityMap } from "../users/visibility.js";

export interface PresenceUser {
  id: string;
  name: string;
}

@Injectable()
export class PresenceService {
  constructor(
    private readonly registry: PerUserSocketRegistry,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Liste der aktuell verbundenen User, sortiert nach Spitzname.
   *
   * Respektiert die Präsenz-Sichtbarkeit jedes verbundenen Users (`presence`
   * in `Profile.visibility`): PRIVATE → für niemanden sichtbar, FRIENDS → nur
   * für bestätigte Freunde, LOGGED_IN (Default) → für alle eingeloggten User.
   * Der `viewerId` sieht sich selbst stets — unabhängig von der eigenen Wahl.
   *
   * Limit kappt die Liste hart (UI-/Performance-Schutz bei Mega-Online).
   */
  async list(viewerId: string, limit: number = 200): Promise<PresenceUser[]> {
    const userIds = await this.registry.listConnectedUserIds(limit);
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, status: "ACTIVE" },
      select: { id: true, name: true, profile: { select: { visibility: true } } },
    });

    // FRIENDS-beschränkte User sammeln, um die Freundschaften in EINER Query
    // gegen den Viewer aufzulösen (statt N Einzelabfragen).
    const friendsOnlyIds = users
      .filter((u) => {
        if (u.id === viewerId) return false;
        const vis = (u.profile?.visibility ?? {}) as VisibilityMap;
        return resolvePresenceVisibility(vis) === "FRIENDS";
      })
      .map((u) => u.id);

    const friendIds = await this.acceptedFriendIds(viewerId, friendsOnlyIds);

    const visible = users.filter((u) => {
      if (u.id === viewerId) return true; // Self sieht sich immer.
      const vis = (u.profile?.visibility ?? {}) as VisibilityMap;
      const level = resolvePresenceVisibility(vis);
      switch (level) {
        case "PRIVATE":
          return false;
        case "FRIENDS":
          return friendIds.has(u.id);
        default: // LOGGED_IN / PUBLIC → für alle Eingeloggten
          return true;
      }
    });

    visible.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return visible.map((u) => ({ id: u.id, name: u.name }));
  }

  /**
   * Präsenz-Status (online + zuletzt-gesehen) für eine gezielte Menge von
   * User-IDs — für die Online-Punkte an Namen. Respektiert pro Ziel-User die
   * Präsenz-Sichtbarkeit: darf der Viewer sie nicht sehen, kommt
   * `{ online: false, lastSeenAt: null }` zurück (kein Leak). Self ist immer
   * sichtbar. IDs werden dedupliziert und hart bei 100 gekappt.
   */
  async statusFor(
    viewerId: string,
    ids: string[]
  ): Promise<Record<string, { online: boolean; lastSeenAt: string | null }>> {
    const unique = [...new Set(ids)].slice(0, 100);
    if (unique.length === 0) return {};
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique }, status: "ACTIVE" },
      select: { id: true, lastSeenAt: true, profile: { select: { visibility: true } } },
    });

    const friendsOnlyIds = users
      .filter((u) => {
        if (u.id === viewerId) return false;
        const vis = (u.profile?.visibility ?? {}) as VisibilityMap;
        return resolvePresenceVisibility(vis) === "FRIENDS";
      })
      .map((u) => u.id);
    const friendIds = await this.acceptedFriendIds(viewerId, friendsOnlyIds);

    const result: Record<string, { online: boolean; lastSeenAt: string | null }> = {};
    for (const u of users) {
      const vis = (u.profile?.visibility ?? {}) as VisibilityMap;
      const level = resolvePresenceVisibility(vis);
      const maySee =
        u.id === viewerId ||
        level === "LOGGED_IN" ||
        level === "PUBLIC" ||
        (level === "FRIENDS" && friendIds.has(u.id));
      if (!maySee) {
        result[u.id] = { online: false, lastSeenAt: null };
        continue;
      }
      const online = (await this.registry.countSockets(u.id)) > 0;
      result[u.id] = { online, lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null };
    }
    return result;
  }

  /**
   * Teilmenge von `candidateIds`, mit denen `viewerId` eine ACCEPTED-Freundschaft
   * hat (in beliebiger Richtung). Leere Kandidatenliste → leeres Set ohne Query.
   */
  private async acceptedFriendIds(viewerId: string, candidateIds: string[]): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: viewerId, addresseeId: { in: candidateIds } },
          { addresseeId: viewerId, requesterId: { in: candidateIds } },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    });
    const ids = new Set<string>();
    for (const f of friendships) {
      ids.add(f.requesterId === viewerId ? f.addresseeId : f.requesterId);
    }
    return ids;
  }
}
