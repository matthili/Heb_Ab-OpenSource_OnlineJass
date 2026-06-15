# Sicherheits-Checkliste

Sicherheit wird **ab Tag 1** mitgedacht, nicht „später nachgerüstet". **Stand: alle hier gelisteten Kontrollen sind umgesetzt** — die Spalte „Meilenstein" nennt nur noch, wann die jeweilige Kontrolle eingeführt wurde.

| #   | Kontrolle                                                       | Wo eingebaut                              | Meilenstein             |
| --- | --------------------------------------------------------------- | ----------------------------------------- | ----------------------- |
| 1   | Argon2id (m=64MiB, t=3, p=1)                                    | `apps/api/src/modules/auth`               | M3                      |
| 2   | HttpOnly + Secure + SameSite=Lax Session-Cookies                | Better Auth                               | M3                      |
| 3   | CSRF: Double-Submit-Token für state-changing REST               | API-Middleware                            | M3                      |
| 4   | Rate-Limit Auth (IP+E-Mail), Chat, WS-Events                    | Redis + `@nestjs/throttler` + WS-Guard    | M3 / M4 / M8            |
| 5   | Zod-Validation auf jedem Endpoint und WS-Event                  | `ZodValidationPipe`, Gateway-Interceptors | M3                      |
| 6   | Markdown-Sanitization (DOMPurify-Allowlist)                     | Chat-Composer + serverseitig              | M8                      |
| 7   | ORM only (Prisma), kein Raw-SQL                                 | ESLint-Custom-Rule + Review               | M3                      |
| 8   | Turnstile bei Register + Login (ab 3 Fails)                     | `modules/auth`                            | M3                      |
| 9   | Audit-Log auf Admin- + Auth-Aktionen + Move-Cheats              | `AuditService`                            | M3 / M4 / M9            |
| 10  | HTTPS + HSTS + CSP via Caddy                                    | `infra/caddy/Caddyfile`                   | M0 (Konfig), M11 (Prod) |
| 11  | Helmet-Header redundant in NestJS                               | `main.ts`                                 | M3                      |
| 12  | Secret-Mgmt via env + sealed-secrets in Helm                    | `.env.example` + ADR                      | M0                      |
| 13  | Server-autoritative Move-Validation, Hände nie an falsche Seats | `modules/game`, WS-Payload-Filter         | M4                      |
| 14  | DSGVO: Cookie-Banner blockiert Sentry pre-consent               | `apps/web`                                | M10 (Stub ab M7)        |
| 15  | Dependency-Audit in CI (`pnpm audit --prod`) + Renovate         | `ci.yml` + `renovate.json`                | M0                      |
| 16  | E-Mail-Tokens single-use + 24h TTL + crypto-random              | `modules/auth`                            | M3                      |
| 17  | Soft-Delete mit Anonymisierung statt Hard-Delete                | User-Model                                | M10                     |
| 18  | Pino redact für PII (Passwort-Felder, Tokens)                   | Pino-Config                               | M3                      |
| 19  | HIBP-Pwned-Passwords-Check (k-Anonymity) bei Register + Reset   | `modules/auth`                            | M3                      |

## Threat-Model (Kurzfassung)

- **Schummeln im Spiel:** Server hält volle Hände im Redis-State, sendet pro Client nur die eigene Sicht + bereits öffentlich gespielte Karten. Move-Validierung 100% serverseitig via `@jass/engine`.
- **Manipulation der KI-Inferenz:** KI läuft im eigenen Microservice; Client sendet niemals state-Vektoren. Eingaben kommen ausschließlich aus dem server-gehaltenen Zustand.
- **Brute-Force auf Login:** Argon2id + Rate-Limit pro IP+E-Mail + Turnstile-Challenge ab Fail-Schwelle.
- **XSS via Chat:** Markdown-Allowlist, DOMPurify im Client _und_ Server-seitige Sanitization vor Persistenz.
- **Account-Übernahme:** Better Auth-Sessions in DB sofort widerrufbar (z.B. bei Passwort-Reset oder Block); Verify-Tokens single-use mit kurzem TTL.
- **DSGVO-Verletzung:** Soft-Delete + Anonymisierung statt Hard-Delete; Cookie-Banner mit echter Wahl; Daten-Export.

## Reporting

Sicherheitslücken bitte **privat** melden — vorzugsweise über das **GitHub-Vulnerability-Reporting** (Security Advisory) dieses Repositorys, nicht über öffentliche Issues. Bitte keine öffentliche Offenlegung vor einem Fix.
