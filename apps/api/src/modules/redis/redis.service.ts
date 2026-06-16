/**
 * Redis-Client für Live-Game-State, Pub/Sub, Rate-Limiting, Presence.
 *
 * Wir behalten den Client als globalen Singleton — eine TCP-Verbindung pro
 * API-Instanz. ioredis kümmert sich um automatic reconnect; bei Multi-Instanz
 * + Socket.IO Redis-Adapter (M4-C) duplizieren wir den Client mit `.duplicate()`
 * für die Pub/Sub-Verbindungen.
 *
 * Lifecycle:
 *   - onModuleInit:    ping() für frühen Connection-Error
 *   - onModuleDestroy: quit() (sauberer Disconnect)
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";

export type RedisClient = Redis;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  readonly client: RedisClient;

  constructor() {
    const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
    this.client = new Redis(url, {
      connectTimeout: 5_000,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    this.client.on("error", (err: Error) => {
      this.log.error({ err }, "Redis connection error");
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.ping();
    this.log.log("Redis connected");
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /**
   * Duplizierter Client (z.B. für Socket.IO Redis-Adapter, der separate
   * Pub-/Sub-Verbindungen braucht).
   */
  duplicate(): RedisClient {
    return this.client.duplicate();
  }

  /**
   * Health-Ping für die Admin-System-Status-Anzeige. `true` = „PONG"
   * erhalten. Fehler werden bewusst geschluckt → die Status-Seite zeigt dann
   * „nicht erreichbar", statt einen 500 zu werfen.
   */
  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
