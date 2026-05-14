/**
 * Prisma-Client als Nest-Provider.
 *
 * Lifecycle:
 *   - onModuleInit:  verbindet (Lazy-Connect ist Default, aber wir wollen einen
 *                    frühen Connection-Error statt eines Lazy-Surprise im ersten Request).
 *   - onModuleDestroy: schließt sauber.
 *
 * Kein eigener Logger — Prisma loggt via seinen eingebauten Mechanismus; Pino
 * kommt im HTTP-Layer dazu.
 */
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
