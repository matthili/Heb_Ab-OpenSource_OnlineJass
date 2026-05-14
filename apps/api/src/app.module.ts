/**
 * Root-Modul. Heute besteht das nur aus Logger + HealthModule; mit jedem
 * Meilenstein kommen weitere Module dazu (auth, users, lobby, game, chat,
 * admin, inference-client).
 */
import type { IncomingMessage } from "node:http";

import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { HealthModule } from "./modules/health/health.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";

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
  imports: [LoggerModule.forRoot({ pinoHttp }), PrismaModule, HealthModule],
})
export class AppModule {}
