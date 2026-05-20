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
import { getTrustedOrigins } from "./common/trusted-origins.js";

const DEFAULT_PORT = 3000;

/**
 * Sicherheits-Flags, die in Production NICHT gesetzt sein dürfen.
 * Wenn jemand `DISABLE_AUTH_RATE_LIMIT=1` oder `DISABLE_PASSWORD_STRENGTH_CHECK=1`
 * unbemerkt in eine Prod-Env schreibt, soll die App den Boot verweigern —
 * sonst läuft die Anwendung mit ausgeschaltetem Schutz ohne Warnung weiter.
 */
function assertNoUnsafeFlagsInProduction(): void {
  if (process.env["NODE_ENV"] !== "production") return;
  const unsafe = [
    "DISABLE_AUTH_RATE_LIMIT",
    "DISABLE_PASSWORD_STRENGTH_CHECK",
    "DISABLE_TURNSTILE",
    "DISABLE_CSRF",
  ].filter((k) => process.env[k] === "1");
  // Phasen-Skalierung darf in production nur 1 (= Default) sein.
  // Kleinere Werte → User hätte keine echte Reconnect-Chance.
  const scale = process.env["DISCONNECT_PHASE_MS_SCALE"];
  if (scale && Number(scale) !== 1) {
    unsafe.push(`DISCONNECT_PHASE_MS_SCALE=${scale}`);
  }
  if (unsafe.length > 0) {
    throw new Error(
      `Sicherheits-Flags dürfen in production NICHT gesetzt sein: ${unsafe.join(", ")}. ` +
        `Diese sind nur für lokale Tests gedacht.`
    );
  }
  // Turnstile-Pflicht in Production. Wer Captcha bewusst nicht will,
  // muss DISABLE_TURNSTILE=1 setzen — siehe oben, das fängt der Check
  // dann ebenfalls ab und wirft. Effektiv: ohne TURNSTILE_SECRET_KEY
  // startet die Production-App nicht.
  if (!process.env["TURNSTILE_SECRET_KEY"]) {
    throw new Error(
      "TURNSTILE_SECRET_KEY ist in production Pflicht. Ein Captcha-Bypass " +
        "würde Register/Forget-Password als Bot-Vektor öffnen."
    );
  }
}

async function bootstrap(): Promise<void> {
  assertNoUnsafeFlagsInProduction();

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

  // Sicherheits-Header: HSTS + grundlegende Defaults. Die strikte CSP wird im
  // Caddy-Reverse-Proxy gesetzt (siehe infra/caddy/Caddyfile), nicht hier.
  await app.register(helmet, {
    contentSecurityPolicy: false, // in Caddy-Reverse-Proxy gesetzt
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  // CORS strict: nur explizit getrustete Origins (gleiche Liste wie der
  // OriginCheckGuard, eine Quelle der Wahrheit). `origin: true` würde
  // mit `credentials: true` jedem Browser-Origin erlauben, authentifizierte
  // Reads zu machen — das wäre eine CSRF-Falle. Hier explizit pinnen.
  const trustedOrigins = getTrustedOrigins();
  app.enableCors({
    origin: (incomingOrigin, callback) => {
      // Kein Origin (z.B. server-to-server / curl): erlaubt — fetch ohne
      // Browser hat keinen Cookie-Kontext, also auch keinen CSRF-Vektor.
      if (!incomingOrigin) return callback(null, true);
      if (trustedOrigins.includes(incomingOrigin)) {
        return callback(null, true);
      }
      // Nicht-trust: kein CORS-Header → Browser blockt die Response.
      // Wir setzen kein `false` als Origin, sondern werfen — das landet
      // im Fastify-Error-Handler als 500, was deutlicher ist als ein
      // stilles 200 ohne Access-Control-Allow-Origin.
      return callback(new Error(`CORS: untrusted origin ${incomingOrigin}`), false);
    },
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
