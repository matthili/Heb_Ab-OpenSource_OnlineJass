/**
 * Wrapper, der die Better-Auth-Instanz lazy aus den injizierten Nest-Providern
 * (Prisma, Mail, Blocklist, Audit, Logger) zusammenbaut.
 *
 * Warum nicht direkt eine Top-Level-Konstante wie in den Better-Auth-Docs?
 *   - Wir wollen den Custom-Argon2id-Hasher konfigurieren, ohne Module-Load-
 *     Reihenfolge zu zerstören.
 *   - Mail-Versand, Blocklist und Audit-Log brauchen Nest-Services.
 *   - In Tests können wir Better Auth gegen eine andere Prisma-Instanz binden,
 *     ohne globalen State zu mutieren.
 *
 * Better Auth selbst exposed seinen HTTP-Handler über `auth.handler(req)` —
 * den ruft der AuthController auf und reicht ihn an Fastify durch.
 */
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { getTrustedOrigins } from "../../common/trusted-origins.js";
import { ADMIN_BOOTSTRAP_ACTION, configuredAdminEmail } from "../admin/admin-bootstrap.util.js";
import { AuditService } from "../audit/audit.service.js";
import { BlocklistService } from "../blocklist/blocklist.service.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { checkPasswordStrength } from "./password-strength.js";
import { checkPasswordBreached } from "./pwned-passwords.js";
import { TurnstileService } from "./turnstile.service.js";

// Better Auth liefert keinen stabilen `Auth`-Export-Type, der zu unserer
// vollständig getypten Config passt — wir lassen TS den Return-Type ableiten.
type BetterAuthInstance = ReturnType<typeof betterAuth>;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger(AuthService.name);
  private _auth: BetterAuthInstance | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly blocklist: BlocklistService,
    private readonly audit: AuditService,
    private readonly turnstile: TurnstileService
  ) {}

  onModuleInit(): void {
    this._auth = this.build();
  }

  get auth(): BetterAuthInstance {
    if (!this._auth) {
      throw new Error("AuthService not initialized yet — onModuleInit must run first.");
    }
    return this._auth;
  }

  private build(): BetterAuthInstance {
    const secret = process.env["BETTER_AUTH_SECRET"];
    if (!secret || secret.length < 32) {
      throw new Error(
        "BETTER_AUTH_SECRET fehlt oder zu kurz (mindestens 32 Zeichen erforderlich)."
      );
    }
    const baseURL = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000";

    // Konto-Freischaltung: "email" (Default) = Verifikation per E-Mail-Link;
    // "admin" (LAN-Mode) = keine Mail, ein Admin schaltet im Panel frei.
    // Das Session-Gate bleibt in BEIDEN Fällen `emailVerified` (require-
    // EmailVerification: true) — im LAN-Mode setzt der Admin es statt einer Mail.
    const accountActivation = process.env["ACCOUNT_ACTIVATION"] === "admin" ? "admin" : "email";

    const blocklist = this.blocklist;
    const audit = this.audit;

    const options: BetterAuthOptions = {
      secret,
      baseURL,
      // Dieselbe Origin-Liste wie CORS + OriginCheckGuard (inkl. TRUSTED_ORIGINS,
      // z.B. LAN-IPs). Sonst weist Better-Auth state-ändernde Requests (Sign-out!)
      // von erlaubten Origins als „fremd" ab, obwohl CORS sie durchlässt.
      trustedOrigins: [...getTrustedOrigins()],
      database: prismaAdapter(this.prisma, { provider: "postgresql" }),
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        minPasswordLength: 12,
        maxPasswordLength: 128,
        autoSignIn: false,
        password: {
          hash: hashPassword,
          verify: ({ hash, password }) => verifyPassword(hash, password),
        },
        // M7-F: Reset-Mail via MailService. URL wird von Better Auth gebaut
        // (basierend auf `redirectTo` aus dem forget-password-Request).
        sendResetPassword: async ({ user, url }) => {
          await this.mail.sendResetPasswordMail({
            to: user.email,
            displayName: user.name,
            resetUrl: url,
          });
          this.log.debug({ userId: user.id }, "reset-password mail dispatched");
        },
        resetPasswordTokenExpiresIn: 60 * 60, // 1 Stunde
      },
      emailVerification: {
        // Im LAN-Mode keine Verifikations-Mail verschicken — der Admin schaltet
        // frei. `requireEmailVerification` (oben) bleibt true → die Session ist
        // bis zur Freischaltung gesperrt.
        sendOnSignUp: accountActivation === "email",
        autoSignInAfterVerification: true,
        expiresIn: 60 * 60 * 24, // 24h
        sendVerificationEmail: async ({ user, url }) => {
          await this.mail.sendVerificationMail({
            to: user.email,
            displayName: user.name,
            verifyUrl: url,
          });
          this.log.debug({ userId: user.id }, "verification mail dispatched");
        },
      },
      // Aktuelle Session: 30 Tage, Update alle 24h
      session: {
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
        // **Cookie-Cache bewusst deaktiviert.** Better Auth bietet einen
        // Server-Side-Cache für Session-Lookups (signiertes Cookie-Payload),
        // der den DB-Roundtrip pro Request einspart. Der hat aber einen
        // hässlichen Side-Effect: nach einem revoke (Self-Service „diese
        // Session abmelden" oder Angriffsfall „alle anderen abmelden")
        // bleibt der widerrufene Cookie bis zum Cache-Ablauf weiterhin
        // gültig — bis zu `maxAge` Sekunden Verzögerung im Sicherheits-Pfad.
        // Wir akzeptieren den Performance-Hit (eine SELECT pro Request)
        // zugunsten von sofortiger Revoke-Wirkung.
        cookieCache: { enabled: false },
      },
      advanced: {
        cookiePrefix: "jass",
      },
      // Rate-Limit: globaler Fallback + strengere Regeln pro Auth-Pfad.
      // Storage in-memory ist ok solange wir Single-Instance laufen; in M11
      // wechseln wir auf `storage: "secondary-storage"` mit Redis-Adapter.
      //
      // In Tests setzen wir `DISABLE_AUTH_RATE_LIMIT=1`, damit Tests, die
      // viele User registrieren, nicht in 429 laufen. Production verlässt
      // sich auf den Default.
      rateLimit: {
        enabled: process.env["DISABLE_AUTH_RATE_LIMIT"] !== "1",
        window: 60, // Sekunden für den globalen Default
        max: 60,
        customRules: {
          // Session-Check der SPA: läuft bei jeder geschützten Navigation +
          // bei useSession. Muss großzügig sein, sonst laufen mehrere Spieler
          // hinter EINER (NAT-)IP beim normalen Klicken in 429 → fälschlicher
          // Auto-Logout. Read-only + günstig, daher unkritisch.
          "/get-session": { window: 60, max: 1000 },
          "/sign-up/email": { window: 3600, max: 3 }, // 3 Registrierungen / Stunde / IP
          "/sign-in/email": { window: 900, max: 5 }, // 5 Login-Versuche / 15 min / IP
          "/forget-password": { window: 3600, max: 3 },
          "/verify-email": { window: 900, max: 10 }, // gegen Token-Brute-Force
          "/reset-password": { window: 900, max: 5 },
        },
      },
      databaseHooks: {
        user: {
          create: {
            before: async (user, ctx) => {
              // Blocklist greift hier — wir werfen einen Better-Auth-APIError,
              // der vom Handler als sauber formatierte Response zurückgegeben wird.
              const match = await blocklist.check(user.email);
              if (match.blocked) {
                await audit.record({
                  action: "auth.register.blocked",
                  meta: {
                    email: user.email,
                    matchedPattern: match.pattern ?? null,
                    reason: match.reason ?? null,
                  },
                  ip: extractIp(ctx),
                });
                throw new APIError("BAD_REQUEST", {
                  message: "Diese E-Mail-Adresse darf sich nicht registrieren.",
                  code: "EMAIL_BLOCKED",
                });
              }
              return { data: user };
            },
            after: async (user, ctx) => {
              await audit.record({
                action: "auth.register.success",
                actorId: user.id,
                meta: { email: user.email, name: user.name },
                ip: extractIp(ctx),
              });
              // Initialen Namens-Historie-Eintrag anlegen (offener Eintrag) —
              // Basis für die Profil-Anzeige + die Namens-Cooldowns.
              await this.prisma.usernameHistory
                .create({ data: { userId: user.id, name: user.name } })
                .catch(() => {
                  /* Historie ist Best-effort; ein Fehler darf die Registrierung nicht kippen. */
                });
              // ── Erst-Admin-Bootstrap ─────────────────────────────────
              // Registriert sich der in ADMIN_EMAIL hinterlegte Account,
              // wird er sofort befördert — ohne API-Neustart. Der Start-up-
              // Pfad (AdminBootstrapService) greift nur für Accounts, die
              // beim Boot schon existieren; dieser Hook deckt den Rest ab.
              const adminEmail = configuredAdminEmail();
              if (adminEmail && user.email.trim().toLowerCase() === adminEmail) {
                await this.prisma.user.update({
                  where: { id: user.id },
                  // Zugleich verifizieren: sonst bliebe der Admin bei (noch)
                  // nicht funktionierendem SMTP ausgesperrt und käme nicht ins
                  // Panel, um SMTP zu reparieren. Eigene ADMIN_EMAIL → ok.
                  data: { role: "ADMIN", emailVerified: true },
                });
                await audit.record({
                  action: ADMIN_BOOTSTRAP_ACTION,
                  actorId: user.id,
                  target: user.id,
                  meta: { email: user.email, via: "ADMIN_EMAIL", source: "register" },
                  ip: extractIp(ctx),
                });
                this.log.log(
                  `ADMIN_EMAIL=${adminEmail}: Neu registrierter User ${user.id} ` +
                    `wurde zum Admin befördert.`
                );
              }
            },
          },
          update: {
            after: async (user, ctx) => {
              // Verify-Step setzt emailVerified=true → eigenes Event.
              if (user.emailVerified === true) {
                await audit.record({
                  action: "auth.verify",
                  actorId: user.id,
                  meta: { email: user.email },
                  ip: extractIp(ctx),
                });
              }
            },
          },
        },
        session: {
          create: {
            // Bei jedem Sign-in legt Better Auth eine Session an — perfekter
            // Hook für „login.success". Login-Fail loggt Better Auth selbst
            // nicht über DB-Hooks; das ergänzen wir bei Bedarf in M3-F per
            // before-Middleware auf `/sign-in/email`.
            after: async (session, ctx) => {
              await audit.record({
                action: "auth.login.success",
                actorId: session.userId,
                meta: {
                  sessionId: session.id,
                  userAgent: session.userAgent ?? null,
                },
                ip: session.ipAddress ?? extractIp(ctx),
              });
            },
          },
        },
      },
      hooks: {
        before: createAuthMiddleware(async (ctx) => {
          const path = ctx.path;
          const isSignUp = path === "/sign-up/email";
          const isReset = path === "/reset-password";
          const isForgot = path === "/forget-password";
          const needsCaptcha = isSignUp || isForgot;
          const needsStrengthCheck = isSignUp || isReset;
          if (!needsStrengthCheck && !needsCaptcha) return;

          const body = (ctx.body ?? {}) as {
            password?: string;
            newPassword?: string;
            email?: string;
            name?: string;
            captchaToken?: string;
          };
          const ip = extractIp(ctx);

          // ── Turnstile (Captcha) bei Registrierung + Passwort-Reset-Mail ──
          // Bewusst NICHT bei /sign-in/email: Login ist durch Rate-Limit
          // + Lockout-Pattern abgedeckt, ein Captcha dort wäre vor allem
          // UX-Bremse. Bot-Registrierungen + Mass-Forgot-Password (Spam-
          // Vektor) sind die kritischeren Pfade.
          if (needsCaptcha && process.env["DISABLE_TURNSTILE"] !== "1") {
            const tokenFromHeader = (ctx.headers?.get?.("x-turnstile-token") ??
              (ctx.request?.headers as Headers | undefined)?.get?.("x-turnstile-token") ??
              undefined) as string | undefined;
            const result = await this.turnstile.verify(body.captchaToken ?? tokenFromHeader, ip);
            if (!result.ok) {
              await this.audit.record({
                action: "security.captcha.reject",
                meta: { path, errors: [...result.errors], email: body.email ?? null },
                ip,
              });
              throw new APIError("BAD_REQUEST", {
                message: "Captcha-Validierung fehlgeschlagen. Bitte erneut versuchen.",
                code: "CAPTCHA_FAILED",
              });
            }
          }

          // ── Passwort-Checks (zxcvbn + HIBP) ──────────────────────────
          // Nur auf Pfaden mit *neuem* Passwort (sign-up + reset).
          // Sign-in prüft NICHT, sonst hätten wir Lock-Out für legacy User.
          // Zwei Layer mit unterschiedlichem Zweck:
          //   - zxcvbn = Entropie/Heuristik („Tr0ubadour!" sieht stark aus)
          //   - HIBP   = Breach-Realität („Tr0ubadour!" steht in den Leaks)
          // Beide einzeln per Env-Flag deaktivierbar (Tests + Boot-Hardening
          // verweigert die Flags in production).
          if (needsStrengthCheck) {
            const pw = body.password ?? body.newPassword;
            if (typeof pw === "string" && pw.length > 0) {
              // ── zxcvbn-Passwort-Stärke ──
              if (process.env["DISABLE_PASSWORD_STRENGTH_CHECK"] !== "1") {
                // Kontext-Eingaben fließen in zxcvbn ein, damit „matthias2026"
                // als Passwort von User „matthias" abgelehnt wird.
                const userInputs: string[] = [];
                if (body.email) {
                  userInputs.push(body.email);
                  const local = body.email.split("@")[0];
                  if (local) userInputs.push(local);
                }
                if (body.name) userInputs.push(body.name);

                const check = await checkPasswordStrength(pw, userInputs);
                if (!check.ok) {
                  const suggestion =
                    check.feedback.warning ??
                    check.feedback.suggestions[0] ??
                    "Bitte ein längeres, weniger vorhersehbares Passwort wählen.";
                  throw new APIError("BAD_REQUEST", {
                    message: `Passwort zu schwach (Score ${check.score}/4): ${suggestion}`,
                    code: "WEAK_PASSWORD",
                  });
                }
              }

              // ── HIBP / Pwned-Passwords ──
              // Fail-open bei Netzwerkfehlern (siehe pwned-passwords.ts);
              // ein HIBP-Outage darf unsere Sign-ups nicht killen.
              if (process.env["DISABLE_HIBP_CHECK"] !== "1") {
                const breach = await checkPasswordBreached(pw);
                if (breach.pwned) {
                  await this.audit.record({
                    action: "security.password.pwned_reject",
                    meta: { path, count: breach.count ?? null, email: body.email ?? null },
                    ip,
                  });
                  const countNote =
                    typeof breach.count === "number"
                      ? ` (${breach.count.toLocaleString("de-DE")} Vorkommen in bekannten Lecks)`
                      : "";
                  throw new APIError("BAD_REQUEST", {
                    message:
                      `Dieses Passwort wurde in einem Datenleck gefunden${countNote}. ` +
                      `Bitte wähle ein anderes — auch wenn es lang aussieht.`,
                    code: "PWNED_PASSWORD",
                  });
                }
              }
            }
          }
        }),
      },
    };
    return betterAuth(options);
  }
}

/**
 * Holt die Client-IP aus dem Better-Auth-Context-Headers — fallback null.
 * In M11 hinter Caddy/Cloudflare wird X-Forwarded-For ausgewertet (Fastify
 * `trustProxy: true` ist bereits gesetzt, also ist `req.ip` korrekt).
 */
function extractIp(ctx: unknown): string | null {
  // ctx ist Better-Auth-spezifisch; defensiv per Property-Sondierung.
  const c = ctx as { request?: { headers?: Headers }; ip?: string } | undefined;
  if (!c) return null;
  if (typeof c.ip === "string") return c.ip;
  const forwarded = c.request?.headers?.get?.("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return null;
}
