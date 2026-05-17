/**
 * SMTP-Mail-Versand via Nodemailer.
 *
 * **Konfig-Quellen** (in dieser Priorität):
 *   1. AdminSetting-Table (siehe `SmtpSettingsService`) — überschreibt Env.
 *   2. Env-Vars `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`
 *      — Bootstrap-Default (Dev: Mailhog `:1025`).
 *
 * **Reload-Strategie**: Wir cachen den Transporter zusammen mit einem
 * Hash der effektiven Config. Bei jedem `send()` laden wir die aktuellen
 * Settings + bauen den Hash; wenn er sich gegen den letzten Lauf
 * unterscheidet, erzeugen wir einen neuen Transporter. So sieht
 * Settings-Change SOFORT ohne API-Restart.
 *
 * Templates sind absichtlich Inline-HTML (kein MJML) — M3 hatte genau
 * eine Mail-Art (Verify), inzwischen sind's drei. Bei mehr Templates
 * können wir auf eine Template-Lib umsteigen.
 */
import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";

import { SmtpSettingsService } from "./smtp-settings.service.js";

interface SmtpConfig {
  host: string;
  port: number;
  user: string | undefined;
  password: string | undefined;
  from: string;
}

interface MailEnvelope {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private cachedTransporter: Transporter | null = null;
  private cachedConfigHash = "";

  constructor(private readonly settings: SmtpSettingsService) {}

  /**
   * Effektive Config laden: erst Env-Default, dann DB-Werte drüber.
   * Beide können separat gesetzt sein — wenn DB nur „host" setzt, kommt
   * Port/User/Password trotzdem vom Env.
   */
  private async resolveConfig(): Promise<SmtpConfig> {
    const fromDb = await this.settings.get();
    return {
      host: fromDb.host ?? process.env["SMTP_HOST"] ?? "localhost",
      port: fromDb.port ?? Number.parseInt(process.env["SMTP_PORT"] ?? "1025", 10),
      user: fromDb.user ?? (process.env["SMTP_USER"] || undefined),
      password: fromDb.password ?? (process.env["SMTP_PASSWORD"] || undefined),
      from: fromDb.from ?? process.env["SMTP_FROM"] ?? "noreply@jass.local",
    };
  }

  private hashConfig(cfg: SmtpConfig): string {
    return createHash("sha256")
      .update(`${cfg.host}|${cfg.port}|${cfg.user ?? ""}|${cfg.password ?? ""}`)
      .digest("hex");
  }

  private async getTransporter(): Promise<{ transporter: Transporter; from: string }> {
    const cfg = await this.resolveConfig();
    const hash = this.hashConfig(cfg);
    if (this.cachedTransporter && this.cachedConfigHash === hash) {
      return { transporter: this.cachedTransporter, from: cfg.from };
    }
    this.log.log({ host: cfg.host, port: cfg.port, user: cfg.user }, "SMTP-Transporter (re-)build");
    this.cachedTransporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? "" } : undefined,
    });
    this.cachedConfigHash = hash;
    return { transporter: this.cachedTransporter, from: cfg.from };
  }

  async send(envelope: MailEnvelope): Promise<void> {
    const { transporter, from } = await this.getTransporter();
    await transporter.sendMail({
      from,
      to: envelope.to,
      subject: envelope.subject,
      text: envelope.text,
      html: envelope.html,
    });
    this.log.debug({ to: envelope.to, subject: envelope.subject }, "mail sent");
  }

  /** Verify-Mail mit Klick-Link. URL wird vom Caller komplett vorbereitet. */
  async sendVerificationMail(opts: {
    to: string;
    displayName: string;
    verifyUrl: string;
  }): Promise<void> {
    const { to, displayName, verifyUrl } = opts;
    const subject = "Willkommen beim Vorarlberger Kreuz-Jass — E-Mail bestätigen";
    const text = [
      `Servus ${displayName},`,
      ``,
      `bitte bestätige deine E-Mail-Adresse, indem du auf den folgenden Link klickst:`,
      verifyUrl,
      ``,
      `Der Link ist 24 Stunden gültig.`,
      ``,
      `Wenn du diese Mail nicht erwartet hast, ignoriere sie einfach — niemand kann ohne Bestätigung mit deiner Adresse spielen.`,
      ``,
      `Pfiati,`,
      `Die Vorarlberger Jass-App`,
    ].join("\n");
    const html = `<!doctype html>
<html lang="de">
  <body style="font-family: system-ui, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px;">
    <h2 style="color:#444;">Servus ${escapeHtml(displayName)},</h2>
    <p>Bitte bestätige deine E-Mail-Adresse, damit du am Vorarlberger Kreuz-Jass mitspielen kannst.</p>
    <p style="text-align:center; margin: 32px 0;">
      <a href="${escapeAttr(verifyUrl)}"
         style="display:inline-block; padding:12px 24px; background:#1f2937; color:#fff; text-decoration:none; border-radius:6px;">
        E-Mail bestätigen
      </a>
    </p>
    <p style="font-size: 13px; color: #666;">Oder kopiere diesen Link in den Browser:<br/>
      <code style="word-break: break-all;">${escapeHtml(verifyUrl)}</code></p>
    <p style="font-size: 12px; color: #999; margin-top: 32px;">
      Der Link ist 24 Stunden gültig. Wenn du diese Mail nicht erwartet hast, ignoriere sie.
    </p>
  </body>
</html>`;
    await this.send({ to, subject, html, text });
  }

  /**
   * Passwort-Reset-Link. Wird vom Better-Auth-Backend-Hook
   * `sendResetPassword` getriggert, wenn ein User
   * `/api/auth/forget-password` aufruft.
   */
  async sendResetPasswordMail(opts: {
    to: string;
    displayName: string;
    resetUrl: string;
  }): Promise<void> {
    const { to, displayName, resetUrl } = opts;
    const subject = "Heb ab! — Passwort zurücksetzen";
    const text = [
      `Servus ${displayName},`,
      ``,
      `du hast einen Passwort-Reset angefordert. Klick auf den folgenden Link:`,
      resetUrl,
      ``,
      `Der Link ist 1 Stunde gültig.`,
      ``,
      `Wenn du den Reset nicht angefordert hast, ignoriere diese Mail — dein Passwort bleibt unverändert.`,
      ``,
      `Pfiati,`,
      `Die Vorarlberger Jass-App`,
    ].join("\n");
    const html = `<!doctype html>
<html lang="de">
  <body style="font-family: system-ui, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px;">
    <h2 style="color:#444;">Servus ${escapeHtml(displayName)},</h2>
    <p>Du hast einen Passwort-Reset angefordert.</p>
    <p style="text-align:center; margin: 32px 0;">
      <a href="${escapeAttr(resetUrl)}"
         style="display:inline-block; padding:12px 24px; background:#1f2937; color:#fff; text-decoration:none; border-radius:6px;">
        Passwort zurücksetzen
      </a>
    </p>
    <p style="font-size: 13px; color: #666;">Oder kopiere diesen Link in den Browser:<br/>
      <code style="word-break: break-all;">${escapeHtml(resetUrl)}</code></p>
    <p style="font-size: 12px; color: #999; margin-top: 32px;">
      Der Link ist 1 Stunde gültig. Wenn du den Reset nicht angefordert hast, ignoriere diese Mail.
    </p>
  </body>
</html>`;
    await this.send({ to, subject, html, text });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
