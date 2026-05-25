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
   * Limit kappt die Liste hart (UI-/Performance-Schutz bei Mega-Online).
   */
  async list(limit: number = 200): Promise<PresenceUser[]> {
    const userIds = await this.registry.listConnectedUserIds(limit);
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, status: "ACTIVE" },
      select: { id: true, name: true },
    });
    users.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return users;
  }
}
