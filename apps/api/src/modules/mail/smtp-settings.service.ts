/**
 * SMTP-Settings im AdminSetting-Table.
 *
 * **Verschlüsselung**: Das SMTP-Passwort wird mit AES-256-GCM
 * verschlüsselt, bevor es in die DB geht. Der Schlüssel kommt aus dem
 * `AppSecretService` (HKDF-Domain-Separation): `purpose="smtp-encryption"`
 * liefert einen 32-Byte-Key, der kryptografisch unabhängig von Auth-
 * oder CSRF-Schlüsseln ist. Compromise des SMTP-Keys verrät weder das
 * Master-Secret noch andere Sub-Keys.
 *
 * **Layout in DB** (AdminSetting.value als Json):
 *   "smtp.host"       → { value: "smtp.example.com" }
 *   "smtp.port"       → { value: 587 }
 *   "smtp.user"       → { value: "user@example.com" } (optional)
 *   "smtp.password"   → { ciphertext, iv, tag } AES-256-GCM-encoded
 *   "smtp.from"       → { value: "Heb ab! <noreply@example.com>" }
 *
 * Bei `null` oder fehlenden Werten fällt der MailService auf die
 * Env-Variablen aus `.env` zurück (Bootstrap-Konfig).
 */
import { Injectable, Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { AppSecretService } from "../../common/app-secret.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface SmtpSettings {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  from: string;
  /** true = No-Reply-Adresse (Antworten werden verworfen → Hinweis in Mails). */
  noReply: boolean;
}

interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

const KEYS = {
  host: "smtp.host",
  port: "smtp.port",
  user: "smtp.user",
  password: "smtp.password",
  from: "smtp.from",
  noReply: "smtp.noReply",
} as const;

@Injectable()
export class SmtpSettingsService {
  private readonly log = new Logger(SmtpSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appSecret: AppSecretService
  ) {}

  /**
   * Lazy-resolve, weil AppSecretService.onModuleInit zwingend vorher
   * läuft (gleicher Boot). Direkt-Aufruf im ctor wäre unsicher, weil
   * NestJS-DI Konstruktoren VOR onModuleInit aufruft.
   */
  private get key(): Buffer {
    return this.appSecret.derive("smtp-encryption");
  }

  /**
   * Lädt alle Settings aus der DB. Returnt `null` für jedes Feld, das
   * nicht gesetzt ist — der Caller (MailService) entscheidet selbst,
   * was bei null gilt (Env-Fallback).
   */
  async get(): Promise<Partial<SmtpSettings>> {
    const rows = await this.prisma.adminSetting.findMany({
      where: { key: { in: Object.values(KEYS) } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const result: Partial<SmtpSettings> = {};
    const host = map.get(KEYS.host) as { value?: string } | undefined;
    if (host?.value) result.host = host.value;
    const port = map.get(KEYS.port) as { value?: number } | undefined;
    if (typeof port?.value === "number") result.port = port.value;
    const user = map.get(KEYS.user) as { value?: string | null } | undefined;
    if (user) result.user = user.value ?? null;
    const from = map.get(KEYS.from) as { value?: string } | undefined;
    if (from?.value) result.from = from.value;
    const noReply = map.get(KEYS.noReply) as { value?: boolean } | undefined;
    if (typeof noReply?.value === "boolean") result.noReply = noReply.value;

    const pwBlob = map.get(KEYS.password) as EncryptedBlob | { value: null } | undefined;
    if (pwBlob && "ciphertext" in pwBlob) {
      try {
        result.password = this.decrypt(pwBlob);
      } catch (err) {
        this.log.error({ err }, "SMTP-Passwort entschlüsseln fehlgeschlagen");
        result.password = null;
      }
    } else if (pwBlob && "value" in pwBlob && pwBlob.value === null) {
      result.password = null;
    }

    return result;
  }

  /**
   * Setzt eine Teilmenge der Settings. `undefined` lässt das Feld
   * unverändert, `null` (für user/password) löscht es ausdrücklich.
   */
  async update(
    actorId: string,
    patch: {
      host?: string | undefined;
      port?: number | undefined;
      user?: string | null | undefined;
      password?: string | null | undefined;
      from?: string | undefined;
      noReply?: boolean | undefined;
    }
  ): Promise<void> {
    const upserts: { key: string; value: unknown }[] = [];
    if (patch.host !== undefined) upserts.push({ key: KEYS.host, value: { value: patch.host } });
    if (patch.port !== undefined) upserts.push({ key: KEYS.port, value: { value: patch.port } });
    if (patch.user !== undefined) upserts.push({ key: KEYS.user, value: { value: patch.user } });
    if (patch.from !== undefined) upserts.push({ key: KEYS.from, value: { value: patch.from } });
    if (patch.noReply !== undefined)
      upserts.push({ key: KEYS.noReply, value: { value: patch.noReply } });
    if (patch.password !== undefined) {
      const blob = patch.password === null ? { value: null } : this.encrypt(patch.password);
      upserts.push({ key: KEYS.password, value: blob });
    }

    for (const { key, value } of upserts) {
      await this.prisma.adminSetting.upsert({
        where: { key },
        // Json-Update in Prisma — `value: ... as Prisma.InputJsonValue`.
        update: { value: value as never, updatedBy: actorId },
        create: { key, value: value as never, updatedBy: actorId },
      });
    }
  }

  private encrypt(plaintext: string): EncryptedBlob {
    const iv = randomBytes(12); // 96 Bit für GCM, NIST-empfohlen
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
    };
  }

  private decrypt(blob: EncryptedBlob): string {
    const iv = Buffer.from(blob.iv, "base64");
    const tag = Buffer.from(blob.tag, "base64");
    const ciphertext = Buffer.from(blob.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString("utf8");
  }
}
