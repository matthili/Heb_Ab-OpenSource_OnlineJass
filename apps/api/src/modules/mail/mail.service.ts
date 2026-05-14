/**
 * SMTP-Mail-Versand via Nodemailer.
 *
 * Dev: Mailhog auf localhost:1025 (keine Auth, keine TLS).
 * Prod: SMTP-Konfiguration kommt in M9 aus dem AdminSetting-Table — bis dahin
 *       reicht ein env-konfiguriertes Setup. Sobald M9 da ist, lädt
 *       `loadSmtpSettings()` die DB-Werte und entschlüsselt sensible Felder.
 *
 * Templates sind absichtlich Inline-HTML (kein MJML noch) — M3 hat genau eine
 * Mail-Art (Verify), Template-Volumen kommt mit Reset + DM-Notifications + … .
 */
import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

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
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    const cfg = this.loadConfig();
    this.from = cfg.from;
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? "" } : undefined,
    });
  }

  private loadConfig(): SmtpConfig {
    return {
      host: process.env["SMTP_HOST"] ?? "localhost",
      port: Number.parseInt(process.env["SMTP_PORT"] ?? "1025", 10),
      user: process.env["SMTP_USER"] || undefined,
      password: process.env["SMTP_PASSWORD"] || undefined,
      from: process.env["SMTP_FROM"] ?? "noreply@jass.local",
    };
  }

  async send(envelope: MailEnvelope): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
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
