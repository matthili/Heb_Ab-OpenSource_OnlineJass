/**
 * Root-Modul. Heute besteht das nur aus Logger + HealthModule; mit jedem
 * Meilenstein kommen weitere Module dazu (auth, users, lobby, game, chat,
 * admin, inference-client).
 */
import type { IncomingMessage } from "node:http";

import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BlocklistModule } from "./modules/blocklist/blocklist.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { MailModule } from "./modules/mail/mail.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";
import { UsersModule } from "./modules/users/users.module.js";

const isDev = process.env["NODE_ENV"] !== "production";

const pinoHttpBase = {
  level: process.env["LOG_LEVEL"] ?? (isDev ? "debug" : "info"),
  // PII redact: Cookies + Authorization-Header niemals in Logs schreiben.
  redact: {
    paths: [
      'req.headers["cookie"]',
      'req.headers["authorization"]',
      'req.headers["x-csrf-token"]',
      "req.body.password",
      "req.body.newPassword",
      "req.body.captchaToken",
    ],
    censor: "[redacted]",
  },
  autoLogging: {
    ignore: (req: IncomingMessage) => req.url === "/health" || req.url === "/healthz",
  },
};

const pinoHttp = isDev
  ? {
      ...pinoHttpBase,
      transport: {
        target: "pino-pretty",
        options: { singleLine: true, translateTime: "SYS:HH:MM:ss" },
      },
    }
  : pinoHttpBase;

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp }),
    PrismaModule,
    MailModule,
    AuditModule,
    BlocklistModule,
    AuthModule,
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
