/**
 * Entry-Point der API-App.
 *
 * - NestJS mit Fastify-Adapter (statt Express): höherer WS-Durchsatz, kleinere
 *   Stack-Frames, kompatibel mit @fastify/cookie + @fastify/helmet, die wir
 *   für CSP/HSTS/Cookies brauchen.
 * - Logger ist Pino (via nestjs-pino); kein eigenes Console-Logging.
 * - Listening-Port aus env (`API_PORT`), Default 3000.
 */
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { IoAdapter } from "@nestjs/platform-socket.io";
import helmet from "@fastify/helmet";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true, // hinter Caddy/Cloudflare X-Forwarded-* nutzen
    }),
    { bufferLogs: true }
  );

  // Pino-Logger als App-Logger setzen, damit auch Nest-interne Log-Quellen
  // strukturiert geloggt werden.
  app.useLogger(app.get(Logger));

  // Sicherheits-Header: HSTS + grundlegende Defaults. Stricte CSP folgt in M11,
  // sobald Frontend-Assets + Inferenz-WS-Origins final feststehen.
  await app.register(helmet, {
    contentSecurityPolicy: false, // in Caddy-Reverse-Proxy gesetzt
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  // CORS bewusst eng halten — same-origin im Compose-Stack, in M11 für Prod
  // explizit auf das öffentliche Frontend-Origin gepinnt.
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Socket.IO als WebSocket-Adapter. NestJS picks den HTTP-Server vom
  // Fastify-Adapter und mountet die Engine.IO-Endpunkte unter `path: "/ws"`
  // (siehe GameGateway).
  app.useWebSocketAdapter(new IoAdapter(app));

  const port = Number.parseInt(process.env["API_PORT"] ?? String(DEFAULT_PORT), 10);
  await app.listen({ port, host: "0.0.0.0" });

  const logger = app.get(Logger);
  logger.log({ port }, `API ready on http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error("[api] bootstrap failed:", err);
  process.exit(1);
});
