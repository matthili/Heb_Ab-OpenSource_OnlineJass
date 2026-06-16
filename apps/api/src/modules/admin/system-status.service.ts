/* eslint-disable no-restricted-syntax -- Die System-Status-Übersicht liest die
   Prisma-Migrations-Tabelle (nicht im Schema modelliert) + macht den DB-Health-
   Ping per Raw-Query. Beides ohne jeden User-Input → keine Injection-Fläche. */
/**
 * Aggregierter Betriebsstatus für die Admin-„System-Status"-Seite.
 *
 * Bündelt, was sonst über mehrere Endpunkte verstreut ist (Health, Inferenz),
 * plus Migrations- und Modus-Infos, damit ein Self-Hoster auf einen Blick
 * sieht, ob die Instanz gesund läuft: DB + Redis erreichbar, Migrationen
 * aktuell, KI-Engine an/aus, in welchem Modus (Self-Host/Prod, Captcha,
 * Konto-Freischaltung) und seit wann der Prozess läuft.
 */
import { Injectable } from "@nestjs/common";

import { InferenceClient } from "../inference/inference-client.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";

export interface SystemStatus {
  db: { ok: boolean };
  migrations: { applied: number; latest: string | null; latestAt: string | null };
  redis: { ok: boolean };
  inference: { available: boolean; lastCheckedAt: number | null; baseUrl: string };
  mode: {
    nodeEnv: string;
    selfHost: boolean;
    /** "admin" = Freischaltung durch Admin (LAN, kein SMTP); sonst "email". */
    accountActivation: string;
    /** false = Turnstile-Captcha aus (nur im Self-Host-/LAN-Modus erlaubt). */
    captchaEnabled: boolean;
  };
  runtime: { nodeVersion: string; uptimeSeconds: number };
  checkedAt: string;
}

@Injectable()
export class SystemStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly inference: InferenceClient
  ) {}

  async getStatus(): Promise<SystemStatus> {
    const [dbOk, migrations, redisOk] = await Promise.all([
      this.checkDb(),
      this.getMigrations(),
      this.redis.ping(),
    ]);

    // Frischer Inferenz-Ping aktualisiert den im Client gecachten Status.
    await this.inference.ping();
    const inf = this.inference.getStatus();

    return {
      db: { ok: dbOk },
      migrations,
      redis: { ok: redisOk },
      inference: {
        available: inf.available,
        lastCheckedAt: inf.lastCheckedAt,
        baseUrl: inf.baseUrl,
      },
      mode: {
        nodeEnv: process.env["NODE_ENV"] ?? "development",
        selfHost: process.env["SELF_HOST"] === "1",
        accountActivation: process.env["ACCOUNT_ACTIVATION"] ?? "email",
        captchaEnabled: Boolean(process.env["TURNSTILE_SECRET_KEY"]),
      },
      runtime: {
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
      },
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Liest die angewandten Migrationen aus Prismas `_prisma_migrations`-Tabelle.
   * Diese Tabelle ist nicht im Schema modelliert → Raw-Query. Schlägt sie fehl
   * (z.B. DB weg), liefern wir 0/null statt zu werfen.
   */
  private async getMigrations(): Promise<{
    applied: number;
    latest: string | null;
    latestAt: string | null;
  }> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ migration_name: string; finished_at: Date | null }>
      >`SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC`;
      const latest = rows[0];
      return {
        applied: rows.length,
        latest: latest?.migration_name ?? null,
        latestAt: latest?.finished_at ? new Date(latest.finished_at).toISOString() : null,
      };
    } catch {
      return { applied: 0, latest: null, latestAt: null };
    }
  }
}
