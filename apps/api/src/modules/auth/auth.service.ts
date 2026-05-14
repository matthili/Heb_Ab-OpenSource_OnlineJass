/**
 * Wrapper, der die Better-Auth-Instanz lazy aus den injizierten Nest-Providern
 * (Prisma, Mail, Logger) zusammenbaut.
 *
 * Warum nicht direkt eine Top-Level-Konstante wie in den Better-Auth-Docs?
 *   - Wir wollen den Custom-Argon2id-Hasher konfigurieren, ohne Module-Load-
 *     Reihenfolge zu zerstören.
 *   - Mail-Versand braucht den Nest-`MailService`.
 *   - In Tests können wir Better Auth gegen eine andere Prisma-Instanz binden,
 *     ohne globalen State zu mutieren.
 *
 * Better Auth selbst exposed seinen HTTP-Handler über `auth.handler(req)` —
 * den ruft der AuthController auf und reicht ihn an Fastify durch.
 */
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { PrismaService } from "../prisma/prisma.service.js";
import { MailService } from "../mail/mail.service.js";
import { hashPassword, verifyPassword } from "./password.js";

// Better Auth liefert keinen stabilen `Auth`-Export-Type, der zu unserer
// vollständig getypten Config passt — wir lassen TS den Return-Type ableiten.
type BetterAuthInstance = ReturnType<typeof betterAuth>;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger(AuthService.name);
  private _auth: BetterAuthInstance | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService
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

    const options: BetterAuthOptions = {
      secret,
      baseURL,
      // Trust nur unsere bekannten Frontend-Origins; in M11 für Prod festziehen.
      trustedOrigins: [baseURL, process.env["WEB_PUBLIC_URL"] ?? "http://localhost:5173"],
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
      },
      emailVerification: {
        sendOnSignUp: true,
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
        cookieCache: { enabled: true, maxAge: 60 * 5 }, // 5 min lokal cachen
      },
      advanced: {
        // In Prod hinter Caddy gibt's Cross-Subdomain-Cookies in M11; aktuell
        // bleibt's same-site Lax.
        cookiePrefix: "jass",
      },
    };
    return betterAuth(options);
  }
}
