/**
 * Root-Modul. Heute besteht das nur aus Logger + HealthModule; mit jedem
 * Meilenstein kommen weitere Module dazu (auth, users, lobby, game, chat,
 * admin, inference-client).
 */
import type { IncomingMessage } from "node:http";

import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { multistream } from "pino";
import pinoPretty from "pino-pretty";

import { AppSecretModule } from "./common/app-secret.module.js";
import { OriginCheckGuard } from "./common/guards/origin-check.guard.js";
import { createSystemLogStream } from "./common/system-log.buffer.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BlocklistModule } from "./modules/blocklist/blocklist.module.js";
import { ChatModule } from "./modules/chat/chat.module.js";
import { PublicConfigModule } from "./modules/config/config.module.js";
import { GameModule } from "./modules/game/game.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { InferenceModule } from "./modules/inference/inference.module.js";
import { LobbyModule } from "./modules/lobby/lobby.module.js";
import { MailModule } from "./modules/mail/mail.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";
import { PushModule } from "./modules/push/push.module.js";
import { RedisModule } from "./modules/redis/redis.module.js";
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

// Konsolen-Ausgabe: im Dev hübsch (pino-pretty als In-Process-Stream — KEIN
// Worker-`transport`, sonst ließe sich der WARN+-Ringpuffer nicht per
// `multistream` danebenhängen), in Production rohes JSON nach stdout.
const consoleStream = isDev
  ? pinoPretty({ singleLine: true, translateTime: "SYS:HH:MM:ss", colorize: true })
  : process.stdout;

@Module({
  imports: [
    // Zwei Log-Ziele: Konsole (alle Level) + WARN+-Ringpuffer für den
    // Admin-System-Log. `pinoHttp` als [Optionen, Ziel-Stream]-Tupel.
    LoggerModule.forRoot({
      pinoHttp: [
        pinoHttpBase,
        multistream([
          { level: isDev ? "debug" : "info", stream: consoleStream },
          { level: "warn", stream: createSystemLogStream() },
        ]),
      ],
    }),
    AppSecretModule,
    PrismaModule,
    RedisModule,
    MailModule,
    AuditModule,
    BlocklistModule,
    PushModule,
    InferenceModule,
    AuthModule,
    UsersModule,
    LobbyModule,
    GameModule,
    ChatModule,
    AdminModule,
    HealthModule,
    PublicConfigModule,
  ],
  providers: [
    // Globaler CSRF-Guard: Origin-Header-Check für state-changing Methoden.
    // Läuft auf jedem HTTP-Request, bevor irgend ein Controller dran kommt.
    { provide: APP_GUARD, useClass: OriginCheckGuard },
  ],
})
export class AppModule {}
