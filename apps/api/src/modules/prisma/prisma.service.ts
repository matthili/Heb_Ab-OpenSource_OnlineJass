/**
 * Prisma-Client als Nest-Provider.
 *
 * Lifecycle:
 *   - onModuleInit:  verbindet (Lazy-Connect ist Default, aber wir wollen einen
 *                    frühen Connection-Error statt eines Lazy-Surprise im ersten Request).
 *   - onModuleDestroy: schließt sauber.
 *
 * **Prisma 7**: Der Schema-`datasource`-Block enthält kein `url` mehr; der
 * Runtime-Client braucht entweder einen **Driver-Adapter** (offiziell für
 * PostgreSQL: `@prisma/adapter-pg`) oder eine `accelerateUrl` (Cloud).
 * Wir nehmen den Adapter — er kapselt einen `pg.Pool` und schickt Queries
 * über die Driver-API von Prisma. Das hat den Nebeneffekt, dass wir in Tests
 * deterministisch eine andere Connection-URL injizieren können.
 *
 * Kein eigener Logger — Prisma loggt via seinen eingebauten Mechanismus; Pino
 * kommt im HTTP-Layer dazu.
 */
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function readDatabaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "DATABASE_URL ist nicht gesetzt — Prisma 7 + PrismaPg-Adapter brauchen eine " +
        "Connection-URL. Setze sie in apps/api/.env (siehe .env.example)."
    );
  }
  return url;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: readDatabaseUrl() }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
