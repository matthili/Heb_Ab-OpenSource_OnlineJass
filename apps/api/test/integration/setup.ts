/**
 * Test-Infrastruktur für Integration-Tests.
 *
 * **Was hier passiert**:
 *   1. Testcontainer für PostgreSQL und Redis starten (echte Container).
 *   2. Prisma-Migration gegen den Test-PG-Container ausführen.
 *   3. Einen kleinen Fastify-Stub für `/predict` und `/health` hochfahren — der
 *      ersetzt den echten Inferenz-Microservice. Die Stub-Antwort ist
 *      konfigurierbar (default: deterministisches argmax = erstes legales).
 *   4. Eine NestJS-App über `@nestjs/testing` bauen, MailService durch einen
 *      In-Memory-Sink überschreiben, dann `app.listen()` auf zufälligem Port.
 *   5. Beim Teardown alle Ressourcen sauber schließen.
 *
 * **Singleton im Worker-Scope**: Vitest läuft mit `pool: forks, singleFork: true`
 * → alle Test-Files teilen einen Worker, also lohnt es sich, Container und App
 * einmalig hochzufahren und zwischen Tests nur die Daten zu resetten. Das spart
 * pro File rund 10 s Container-Boot.
 *
 * **Mail-Sink**: Tests, die den Verify-Flow brauchen, können den Sink lesen
 * und die letzte Verify-URL extrahieren. Schneller und deterministischer als
 * gegen Mailhog zu pollen.
 */
// `reflect-metadata` muss als ERSTES geladen werden, sonst kann NestJS bei der
// Constructor-DI die Parameter-Typen nicht resolven — alle injizierten
// Services werden dann `undefined`. Im normalen Bootstrap kommt das aus
// `@nestjs/core` als Side-Effect; im Test bringen wir es explizit ein.
import "reflect-metadata";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve as resolvePath } from "node:path";

import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import Fastify, { type FastifyInstance } from "fastify";

import { AppModule } from "../../src/app.module.js";
import { AdminService } from "../../src/modules/admin/admin.service.js";
import { ChatCleanupService } from "../../src/modules/chat/chat-cleanup.service.js";
import { GameService } from "../../src/modules/game/game.service.js";
import { ReplayService } from "../../src/modules/game/replay.service.js";
import { GdprService } from "../../src/modules/users/gdpr.service.js";
import { AutoFillService } from "../../src/modules/lobby/auto-fill.service.js";
import { MailService } from "../../src/modules/mail/mail.service.js";
import { PrismaService } from "../../src/modules/prisma/prisma.service.js";
import { RedisService } from "../../src/modules/redis/redis.service.js";

const execFileAsync = promisify(execFile);

/** API-Workspace-Root, relativ zu diesem Setup-File. */
const API_ROOT = resolvePath(import.meta.dirname, "..", "..");

/**
 * Verify-Mails, die im aktuellen Test-Lauf abgesetzt wurden.
 *
 * Jeder Eintrag hat `to`, `verifyUrl`, `displayName` — wir behalten alles, was
 * die Tests evtl. lesen wollen. `reset()` leert das Array zwischen Tests.
 */
export interface CapturedMail {
  to: string;
  displayName: string;
  verifyUrl: string;
}

/**
 * Stub-Antwort-Konfiguration für den Inferenz-Stub.
 *
 * Default: `mode: "argmax-of-mask"` → der Stub gibt das erste legale Bit aus
 * der Maske als argmax zurück — deterministisch und ohne dass die Tests einen
 * echten Encoder/Decoder mitführen müssen. Mit `mode: "status"` antwortet er
 * mit dem gegebenen HTTP-Status (z.B. 503 für Fallback-Tests).
 */
export type InferenceStubMode =
  | { mode: "argmax-of-mask" }
  | { mode: "status"; status: number; body?: unknown };

export interface InferenceStubControl {
  /** Anzahl bisheriger /predict-Aufrufe. Zwischen Tests via `reset()` auf 0. */
  callCount: number;
  /** Antwort-Verhalten setzen. Wirkt ab dem nächsten Request. */
  setMode(m: InferenceStubMode): void;
  /** Counter und Mode auf Default zurücksetzen. */
  reset(): void;
}

export interface TestAppHandle {
  /** Lauschende HTTP-Adresse mit Port, z.B. `http://127.0.0.1:54321`. */
  baseUrl: string;
  /** Prisma-Client (für Daten-Reset zwischen Tests). */
  prisma: PrismaService;
  /** Redis-Client (für Daten-Reset). */
  redis: RedisService;
  /** GameService aus dem DI-Container — für Service-direkte Game-Tests. */
  games: GameService;
  /** ReplayService aus dem DI-Container. */
  replay: ReplayService;
  /** GdprService aus dem DI-Container. */
  gdpr: GdprService;
  /** AdminService aus dem DI-Container. */
  admin: AdminService;
  /** Auto-Fill-Sweeper. In Tests stoßen wir `.tick()` manuell an. */
  autoFill: AutoFillService;
  /** Chat-Cleanup-Service. Test-Setup setzt DISABLE_CHAT_CLEANUP=1, sodass das
   *  Interval nicht ticked — Tests stoßen `.tick()` deterministisch manuell an. */
  chatCleanup: ChatCleanupService;
  /** Capture-Sink des Mail-Services. */
  capturedMails: CapturedMail[];
  /** Steuerung des Inferenz-Stubs. */
  inference: InferenceStubControl;
  /** Tabellen-Truncate + Redis-Flush + Capture-Reset. Zwischen Tests aufrufen. */
  resetData(): Promise<void>;
}

let cached: TestAppHandle | null = null;
let teardown: (() => Promise<void>) | null = null;

/**
 * Singleton-Setup. Idempotent — beim zweiten Aufruf gibt es den gecachten
 * Handle zurück. Beim Vitest-Worker-Shutdown muss `teardownTestApp()` laufen
 * (siehe vitest.integration.config.ts → `globalTeardown`).
 */
export async function setupTestApp(): Promise<TestAppHandle> {
  if (cached) return cached;

  // ─── 1. Container hochfahren ──────────────────────────────────────────
  const pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("jass_test")
    .withUsername("jass_test")
    .withPassword("jass_test")
    .start();
  const redis = await new RedisContainer("redis:7-alpine").start();

  // ─── 2. Env-Vars setzen, die NestJS-Provider beim Init lesen ─────────
  const databaseUrl = pg.getConnectionUri();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env["DATABASE_URL"] = databaseUrl;
  process.env["REDIS_URL"] = redisUrl;
  // Inferenz-Stub: bekommt seinen eigenen Port erst nach app.listen() — wir
  // setzen die URL gleich auf einen Platzhalter und überschreiben nach Stub-Boot.
  process.env["INFERENCE_URL"] = "http://127.0.0.1:0";
  process.env["INFERENCE_TIMEOUT_MS"] = "2000";
  // KI-Schritt-Delay im WS-Gateway: Production-Default ist 1500ms, damit
  // der menschliche Spieler die KI-Karten sieht. In Tests muss der Wert
  // klein sein, sonst läuft die 36-Move-Loop in den 20s-Test-Timeout.
  process.env["AI_STEP_DELAY_MS"] = "20";
  // Better Auth braucht ein Secret ≥ 32 Bytes. Bei Tests: deterministisch.
  process.env["BETTER_AUTH_SECRET"] = "test-secret-deterministic-32bytes-min-aaaa";
  // Master-Secret für AppSecretService (HKDF-Domain-Separation für SMTP-
  // Encryption etc.). Deterministisch in Tests, damit verschlüsselte
  // Werte über Test-Reloads erhalten bleiben. Production-Validation
  // greift hier nicht — wir laufen mit NODE_ENV=test.
  process.env["APP_SECRET"] = "test-app-secret-deterministic-32bytes-min-bbbb";
  // zxcvbn-Passwort-Stärke-Check für Tests deaktivieren — die Test-Helper
  // benutzen kurze Demo-Passwörter wie "password-12-chars", die zxcvbn
  // zu Recht ablehnt. Boot in production verweigert dieses Flag.
  process.env["DISABLE_PASSWORD_STRENGTH_CHECK"] = "1";
  // HIBP-Range-API-Aufruf in Tests deaktivieren — wäre ein echter HTTPS-
  // Call ins Internet, flaky + langsam (~300ms × jedes Sign-up). Boot in
  // production verweigert dieses Flag (assertNoUnsafeFlagsInProduction).
  process.env["DISABLE_HIBP_CHECK"] = "1";
  // Turnstile in Tests deaktivieren — kein Cloudflare-Round-Trip, keine
  // Tokens. Boot in production verweigert dieses Flag.
  process.env["DISABLE_TURNSTILE"] = "1";
  // Disconnect-Vote-Phasen für Tests stark verkürzen (5% der Realzeit):
  //   GRACE_1: 6 s statt 120 s
  //   VOTE_1:  0.75 s statt 15 s
  //   GRACE_2: 3 s statt 60 s
  //   VOTE_2:  0.75 s statt 15 s
  // Boot in production verweigert ≠ 1.
  process.env["DISCONNECT_PHASE_MS_SCALE"] = "0.05";
  process.env["BETTER_AUTH_URL"] = "http://127.0.0.1:3000"; // wird gleich überschrieben
  process.env["SMTP_HOST"] = "127.0.0.1"; // wird vom MailSink eh nicht genutzt
  process.env["SMTP_PORT"] = "1025";
  // Pino-Default in Dev ist `debug` mit pino-pretty — das spammt tausende
  // Zeilen in den Test-Output. `silent` schaltet ihn komplett ab; via
  // TEST_LOG_LEVEL kann man bei Bedarf temporär hochdrehen.
  process.env["LOG_LEVEL"] = process.env["TEST_LOG_LEVEL"] ?? "silent";
  // Better-Auth Rate-Limit für Tests entschärfen — sonst hauen
  // Multi-User-Setups in 429 raus (3 Sign-Ups pro Stunde pro IP ist scharf).
  process.env["DISABLE_AUTH_RATE_LIMIT"] = "1";
  // Auto-Fill-Sweeper-Intervall in Tests deaktivieren — Tests stoßen
  // `AutoFillService.tick()` deterministisch manuell an, damit das nicht
  // zur Race-Condition zwischen Test und Sweeper-Tick wird.
  process.env["DISABLE_AUTO_FILL_SWEEPER"] = "1";
  // Chat-Cleanup-Interval in Tests deaktivieren — analog zum Auto-Fill,
  // Tests stoßen `ChatCleanupService.tick()` manuell an.
  process.env["DISABLE_CHAT_CLEANUP"] = "1";

  // ─── 3. Prisma-Migrate gegen Test-DB ──────────────────────────────────
  // `prisma migrate deploy` aus apps/api/. Wir spawn'en den CLI-Subprocess statt
  // die SQL-Files selber zu parsen — testet zugleich, dass die Migrationen
  // gegen einen frischen PG laufen.
  //
  // Wichtig: auf Windows ist `pnpm` ein `.cmd`-Shim — `execFile` ohne `shell`
  // findet ihn nicht. Mit `shell: true` interpretiert die Shell die Args, was
  // aber bei einer fest-getypten URL-Konstante unproblematisch ist (kein
  // User-Input). Ein Fehl-Exit muss zwingend laut werden — Stille hier endet
  // sonst in "relation does not exist" beim ersten Query.
  //
  // Kritisch: Prisma's `prisma.config.ts` macht `import "dotenv/config"`, das die
  // `apps/api/.env` lädt. Wenn die `.env` ein `DATABASE_URL` enthält und dotenv
  // sie aus irgendeinem Grund overrideen würde, läuft der Migrate gegen die
  // DEV-DB statt die Testcontainer-DB — schweigend, weil dort die Tabellen
  // bereits existieren. Dotenv ist default-non-overwrite (`override: false`),
  // also bleibt unsere injizierte URL. Wir verifizieren das via stdout-Diagnose
  // ("Datasource at \"db\": ... at \"<host>:<port>\"") und brechen ab, wenn der
  // Port nicht zum Testcontainer passt.
  const migrate = await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: true,
  }).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
    throw new Error(
      `prisma migrate deploy failed (exit ${err.code ?? "?"}):\n` +
        `STDOUT:\n${err.stdout ?? "<empty>"}\n` +
        `STDERR:\n${err.stderr ?? "<empty>"}`
    );
  });
  // Defensive: Wenn Prisma die Migration gegen die DEV-DB statt den Testcontainer
  // gefahren hätte, würden die nachfolgenden TRUNCATE/Queries gegen eine leere
  // DB laufen. Den Port aus dem stdout fischen verifiziert das billig.
  const expectedPort = new URL(databaseUrl).port;
  if (!migrate.stdout.includes(`:${expectedPort}`)) {
    throw new Error(
      `prisma migrate deploy lief NICHT gegen den Testcontainer-Port ${expectedPort}:\n` +
        `${migrate.stdout}`
    );
  }

  // ─── 4. Inferenz-Stub hochfahren ──────────────────────────────────────
  const stub = await startInferenceStub();
  process.env["INFERENCE_URL"] = stub.baseUrl;

  // ─── 5. Mail-Sink statt echtem SMTP ───────────────────────────────────
  const capturedMails: CapturedMail[] = [];
  const mailSink: Pick<MailService, "send" | "sendVerificationMail"> = {
    async send() {
      /* no-op — Verify-Mails laufen via sendVerificationMail */
    },
    async sendVerificationMail(opts) {
      capturedMails.push({
        to: opts.to,
        displayName: opts.displayName,
        verifyUrl: opts.verifyUrl,
      });
    },
  };

  // ─── 6. NestJS-App bauen + listen ────────────────────────────────────
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mailSink)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: false, logger: false }
  );
  app.enableCors({ origin: true, credentials: true });
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.init();
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") {
    throw new Error("App-Listen-Adresse unerwartet leer/string");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  process.env["BETTER_AUTH_URL"] = baseUrl;

  const prisma = app.get(PrismaService);
  const redisSvc = app.get(RedisService);
  const gamesSvc = app.get(GameService);
  const replaySvc = app.get(ReplayService);
  const gdprSvc = app.get(GdprService);
  const adminSvc = app.get(AdminService);
  const autoFillSvc = app.get(AutoFillService);
  const chatCleanupSvc = app.get(ChatCleanupService);

  // ─── 7. Reset-Funktion ────────────────────────────────────────────────
  // TRUNCATE löscht Daten ohne Schema anzufassen. CASCADE räumt FK-Tabellen
  // mit. RESTART IDENTITY setzt die BigInt-Sequenz für Moves/AuditLog zurück.
  //
  // Wichtig: Prisma legt Tabellen mit PascalCase-Namen an (`"Move"`); in
  // Postgres sind unquoted identifiers lowercased, also würde
  // `TRUNCATE Move` zu `relation "move" does not exist`. Alle Namen daher
  // explizit gequotet.
  const truncatableTables = [
    `"RematchVote"`,
    `"TableInvite"`,
    `"GameJoinRequest"`,
    `"LobbyTableSeat"`,
    `"LobbyTable"`,
    `"Move"`,
    `"RoundDecision"`,
    `"GameSeat"`,
    `"Game"`,
    `"ChatMessage"`,
    `"ArchivedChatMessage"`,
    `"AuditLog"`,
    `"Friendship"`,
    `"Profile"`,
    `"Verification"`,
    `"Account"`,
    `"Session"`,
    `"User"`,
    `"Blocklist"`,
    `"BannedWord"`,
    `"AdminSetting"`,
  ];
  async function resetData(): Promise<void> {
    capturedMails.length = 0;
    stub.control.reset();
    // Raw-SQL bewusst: ein typsicheres "TRUNCATE viele Tabellen mit RESTART
    // IDENTITY CASCADE in einer Anweisung" gibt es im Prisma-Client nicht.
    // Die Liste wird aus einem statischen Array gebaut (keine User-Inputs),
    // also kein Injection-Risiko. Pro Test-Reset, nur Test-Code.
    // eslint-disable-next-line no-restricted-syntax
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${truncatableTables.join(", ")} RESTART IDENTITY CASCADE;`
    );
    await redisSvc.client.flushdb();
  }

  // ─── 8. Teardown registrieren ─────────────────────────────────────────
  teardown = async () => {
    try {
      await app.close();
    } catch {
      /* swallow — Container-Stop ist wichtiger */
    }
    try {
      await stub.close();
    } catch {
      /* */
    }
    await pg.stop({ timeout: 5_000 }).catch(() => {});
    await redis.stop({ timeout: 5_000 }).catch(() => {});
    cached = null;
    teardown = null;
  };

  cached = {
    baseUrl,
    prisma,
    redis: redisSvc,
    games: gamesSvc,
    replay: replaySvc,
    gdpr: gdprSvc,
    admin: adminSvc,
    autoFill: autoFillSvc,
    chatCleanup: chatCleanupSvc,
    capturedMails,
    inference: stub.control,
    resetData,
  };
  return cached;
}

export async function teardownTestApp(): Promise<void> {
  if (teardown) await teardown();
}

// ─── Inferenz-Stub ────────────────────────────────────────────────────────

interface InferenceStub {
  baseUrl: string;
  control: InferenceStubControl;
  close(): Promise<void>;
}

async function startInferenceStub(): Promise<InferenceStub> {
  const app: FastifyInstance = Fastify({ logger: false });
  let mode: InferenceStubMode = { mode: "argmax-of-mask" };
  let callCount = 0;

  const control: InferenceStubControl = {
    get callCount() {
      return callCount;
    },
    set callCount(v: number) {
      callCount = v;
    },
    setMode(m) {
      mode = m;
    },
    reset() {
      mode = { mode: "argmax-of-mask" };
      callCount = 0;
    },
  };

  app.get("/health", () => ({
    status: "ok",
    ts: new Date().toISOString(),
    meta: { releaseVersion: "stub", specVersion: "1.1.0", encodingVersion: "3.0.0" },
  }));

  app.post<{ Body: { state: number[]; mask: number[] } }>("/predict", async (req, reply) => {
    callCount++;
    if (mode.mode === "status") {
      reply.code(mode.status);
      return mode.body ?? { error: `stub-status-${mode.status}` };
    }
    // argmax-of-mask: erstes legales Bit
    const mask = req.body.mask;
    let argmax = -1;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 1) {
        argmax = i;
        break;
      }
    }
    if (argmax < 0) {
      reply.code(400);
      return { error: "stub: keine legale Aktion in mask" };
    }
    // Policy ist 1.0 auf argmax, 0 sonst — illegale Aktionen sind eh maskiert.
    const policy = new Array<number>(mask.length).fill(0);
    policy[argmax] = 1;
    return {
      policy,
      value: 0,
      argmax,
      meta: { releaseVersion: "stub", specVersion: "1.1.0", encodingVersion: "3.0.0" },
    };
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Stub-Listen-Adresse unerwartet leer/string");
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    control,
    close: () => app.close(),
  };
}
