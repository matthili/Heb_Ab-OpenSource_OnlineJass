/**
 * **Per-User-Limits für WebSocket-Connections.**
 *
 * Schließt zwei Lücken, die das Per-Socket-Rate-Limit allein nicht
 * abdeckt:
 *
 *   1. **Socket-Mengen-Limit**: Ein User kann beliebig viele Tabs/Geräte
 *      öffnen → ohne Begrenzung wären Memory + FD + Pub/Sub-Last
 *      linear in der Tab-Zahl. Wir kappen bei `MAX_SOCKETS_PER_USER = 5`
 *      (typisches Setup: Desktop + Tablet + Phone + 2 Reserve-Tabs).
 *      Bei Überschreitung wird der **älteste** Socket disconnected —
 *      neue Anmeldung gewinnt, alte Tabs verlieren. Das ist freundlicher
 *      als "neuer Connect abgelehnt", weil der User die alten ggf.
 *      vergessen hat.
 *
 *   2. **Per-User-Aggregat-Rate-Limit**: Per-Socket-Limit ist mit 100
 *      Tabs trivial umgangen. Hier zählen wir Events pro `userId` über
 *      ALLE Sockets hinweg, in Redis (damit es Multi-Instance-fähig
 *      bleibt, sobald wir skalieren).
 *
 * **Storage:**
 *   - `ws:user:{userId}:sockets` — Sorted Set, score = Connect-Timestamp.
 *     Erlaubt günstigen Top-N-älteste-Lookup via ZRANGE.
 *   - `ws:user:{userId}:rate` — Sorted Set, score = Event-Timestamp.
 *     Sliding-Window-Counter: ZREMRANGEBYSCORE entfernt alte, ZCARD zählt.
 *
 * Beide Keys haben TTLs; wenn ein User mal länger offline ist, räumt
 * Redis sie automatisch ab.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";

import { RedisService } from "../redis/redis.service.js";

export const MAX_SOCKETS_PER_USER = 5;

/**
 * Aggregat-Limit über ALLE Sockets eines Users hinweg.
 * Bewusst etwas großzügiger als das Per-Socket-Limit (sonst wäre der
 * User-Limit faktisch das Pro-Socket-Limit). Bei 5 Sockets × normale
 * Aktivität läuft kein realer Nutzer in die Nähe.
 */
const USER_EVENT_WINDOW_MS = 10_000;
const USER_EVENT_MAX = 100;

const SOCKETS_TTL_S = 3600; // 1h Inaktivität → Set verfällt
const RATE_TTL_S = 60;

export interface UserConnectResult {
  /** Welche Sockets sollen disconnected werden (aus User-Sicht: alte Tabs). */
  evictSocketIds: string[];
}

@Injectable()
export class PerUserSocketRegistry {
  private readonly log = new Logger(PerUserSocketRegistry.name);

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  private socketsKey(userId: string): string {
    return `ws:user:${userId}:sockets`;
  }

  private rateKey(userId: string): string {
    return `ws:user:${userId}:rate`;
  }

  /**
   * Beim Connect aufrufen. Trägt den Socket ein und prüft das
   * Mengen-Limit. Returnt Socket-IDs, die der Caller disconnecten soll
   * (alte Tabs, die durch die neue Anmeldung verdrängt werden).
   */
  async register(userId: string, socketId: string): Promise<UserConnectResult> {
    const key = this.socketsKey(userId);
    const now = Date.now();
    const client = this.redis.client;

    // 1. Eigenen Socket eintragen (overwrite ist ok — Same-ID wäre ein Reconnect).
    await client.zadd(key, now, socketId);
    await client.expire(key, SOCKETS_TTL_S);

    // 2. Aktuelle Anzahl prüfen.
    const count = await client.zcard(key);
    if (count <= MAX_SOCKETS_PER_USER) {
      return { evictSocketIds: [] };
    }

    // 3. Älteste über das Limit hinaus rauswerfen.
    const evictCount = count - MAX_SOCKETS_PER_USER;
    // ZRANGE 0 evictCount-1 → die ältesten Einträge.
    const evict = await client.zrange(key, 0, evictCount - 1);
    if (evict.length > 0) {
      await client.zrem(key, ...evict);
    }
    return { evictSocketIds: evict };
  }

  /**
   * Beim Disconnect aufrufen.
   */
  async unregister(userId: string, socketId: string): Promise<void> {
    await this.redis.client.zrem(this.socketsKey(userId), socketId);
  }

  /**
   * Wie viele Sockets sind aktuell für diesen User registriert? Wird
   * vom Disconnect-Vote-Trigger benutzt, um zu entscheiden: ist der
   * User wirklich „offline" (= 0 Sockets) oder nur einer von mehreren
   * Tabs weg.
   */
  async countSockets(userId: string): Promise<number> {
    return this.redis.client.zcard(this.socketsKey(userId));
  }

  /**
   * Prüft das Aggregat-Limit. Returnt `true` = erlaubt, `false` =
   * Drosseln. Aufrufer ist verantwortlich, das Frame zu verwerfen.
   * Eigenes Audit-Logging hier nicht (Caller hat mehr Kontext).
   */
  async checkRate(userId: string, now: number = Date.now()): Promise<boolean> {
    const key = this.rateKey(userId);
    const cutoff = now - USER_EVENT_WINDOW_MS;
    const client = this.redis.client;

    // Pipeline für atomare Drei-Step-Operation. Wenn Redis temporär
    // langsam ist, zahlt eh nur diese Drosselung — kein State-Korruption.
    const pipe = client.multi();
    pipe.zremrangebyscore(key, 0, cutoff);
    pipe.zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 8)}`);
    pipe.zcard(key);
    pipe.expire(key, RATE_TTL_S);
    const results = await pipe.exec();
    if (!results) return true; // Bei Redis-Outage NICHT blocken (Fail-Open für UX)
    // `exec()` liefert [[err, val], ...] in der Reihenfolge der Befehle.
    // ZCARD ist Index 2.
    const cardResult = results[2];
    if (!cardResult) return true;
    const [err, val] = cardResult;
    if (err) {
      this.log.warn({ err }, "checkRate: Redis-Fehler — fail-open");
      return true;
    }
    const count = typeof val === "number" ? val : Number(val);
    return count <= USER_EVENT_MAX;
  }

  /** Limit-Konstanten exposed für Tests und Frontend-Hints. */
  readonly maxSocketsPerUser = MAX_SOCKETS_PER_USER;
  readonly userEventWindowMs = USER_EVENT_WINDOW_MS;
  readonly userEventMax = USER_EVENT_MAX;
}
