/**
 * AFK-/Pause-Status pro User.
 *
 * Transienter Laufzeit-Zustand (wie die Socket-Präsenz), daher in Redis und
 * nicht in der DB: ein einzelnes Set `presence:afk` mit allen aktuell als
 * abwesend markierten User-IDs. Multi-Instance-fähig, überlebt keinen
 * vollständigen Logout (wird beim letzten Socket-Disconnect geräumt) — wer
 * zurückkommt, ist wieder „online", nicht „abwesend".
 *
 * Liegt bewusst im Game-Modul (nicht Lobby), damit das `GameGateway` den
 * Status beim Disconnect räumen kann, ohne eine Lobby→Game→Lobby-Zyklus-
 * Abhängigkeit zu erzeugen (Lobby importiert GameModule bereits).
 */
import { Injectable } from "@nestjs/common";

import { RedisService } from "../redis/redis.service.js";

const AFK_SET = "presence:afk";

@Injectable()
export class AfkService {
  constructor(private readonly redis: RedisService) {}

  async isAfk(userId: string): Promise<boolean> {
    return (await this.redis.client.sismember(AFK_SET, userId)) === 1;
  }

  async setAfk(userId: string, afk: boolean): Promise<void> {
    if (afk) await this.redis.client.sadd(AFK_SET, userId);
    else await this.redis.client.srem(AFK_SET, userId);
  }

  /** Teilmenge der `userIds`, die aktuell als abwesend markiert sind. */
  async filterAfk(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const flags = await this.redis.client.smismember(AFK_SET, ...userIds);
    const afk = new Set<string>();
    flags.forEach((f, i) => {
      const id = userIds[i];
      if (f === 1 && id) afk.add(id);
    });
    return afk;
  }
}
