/**
 * **Master-Secret-Verwaltung mit Domain-Separation.**
 *
 * Alle krypto-sensiblen Sub-Schlüssel der App (SMTP-Password-Encryption,
 * spätere CSRF-Token-Signing, Audit-Log-HMAC etc.) leiten sich aus
 * **einem** Master-Secret in der Env-Variable `APP_SECRET` ab — über
 * **HKDF-SHA-256** mit einem zweckabhängigen `info`-Parameter.
 *
 * **Warum HKDF, nicht direkt SHA-256(secret)?**
 *   - Domain-Separation: `derive("smtp")` und `derive("csrf")` liefern
 *     kryptografisch unabhängige 32-Byte-Schlüssel. Kompromittierung
 *     eines Sub-Keys verrät nichts über die anderen — auch nicht über
 *     das Master-Secret.
 *   - Standardisiert (RFC 5869), in Node.js' crypto-Modul nativ.
 *   - Niemand außer dieser Klasse fasst das Master-Secret jemals an;
 *     andere Services bekommen NUR den abgeleiteten Sub-Key.
 *
 * **Boot-Hardening:**
 *   - In `NODE_ENV === "production"` ist `APP_SECRET` Pflicht.
 *     Fehlt es, ist es zu kurz (<32 Zeichen) oder steht es auf einem
 *     **bekannten schwachen Wert** (siehe WEAK_VALUES) → **Hard-Fail
 *     beim Boot**. Die App startet gar nicht erst.
 *   - In Dev/Test ist ein generierter Fallback OK, wird aber laut
 *     geloggt — niemand soll versehentlich mit einem Dev-Secret in
 *     Production gehen.
 *
 * **Bewusst keine Übernahme von `BETTER_AUTH_SECRET`:**
 * Better Auth verwaltet sein eigenes Secret. Wir wollen die Schlüssel
 * für *unsere* Krypto **nicht** mit dem Session-Signing-Key teilen —
 * sonst hat ein Leak von Auth-Sessions plötzlich auch Implikationen
 * auf SMTP-Passwörter. Ein Secret pro Verantwortung.
 */
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { hkdfSync, randomBytes } from "node:crypto";

/**
 * Bekannte schwache / Placeholder-Werte — wenn jemand das im Production-
 * Env stehen lässt, lehnen wir den Boot ab. Liste eher konservativ
 * halten, damit niemand mit „passwordpasswordpasswordpassword" durchkommt
 * (zu schwach, aber regulär lang), aber definitiv die obvious Strings.
 */
const WEAK_VALUES: readonly string[] = [
  "dev-fallback",
  "change-me",
  "changeme",
  "secret",
  "password",
  "test-secret-deterministic-32bytes-min-aaaa", // unser Test-Default
  "00000000000000000000000000000000",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
];

/**
 * Zweck-Identifier für `derive()`. Hier explizit auflisten statt frei
 * Strings rein zu geben — vergibt Type-Safety + macht alle aktiven
 * Sub-Keys an einer Stelle sichtbar (Audit-Hilfe).
 */
export type SecretPurpose = "smtp-encryption" | "csrf-token" | "audit-hmac" | "rematch-vote-token";

@Injectable()
export class AppSecretService implements OnModuleInit {
  private readonly log = new Logger(AppSecretService.name);
  private masterSecret!: Buffer;
  /** Cache abgeleiteter Sub-Keys — derive() ist deterministisch + häufig genutzt. */
  private readonly cache = new Map<SecretPurpose, Buffer>();

  onModuleInit(): void {
    const env = process.env["NODE_ENV"] ?? "development";
    const raw = process.env["APP_SECRET"];

    if (env === "production") {
      // ── Production-Hardening ──────────────────────────────────────
      if (!raw) {
        throw new Error(
          "APP_SECRET ist in production Pflicht. Setze eine kryptografisch zufällige Zeichenkette (≥ 32 Zeichen)."
        );
      }
      if (raw.length < 32) {
        throw new Error(
          `APP_SECRET ist zu kurz (${raw.length} Zeichen, mindestens 32 erforderlich).`
        );
      }
      if (WEAK_VALUES.includes(raw) || /^(.)\1+$/.test(raw)) {
        throw new Error(
          "APP_SECRET ist offensichtlich schwach (Placeholder oder repetitives Muster). Bitte einen frisch generierten Wert verwenden."
        );
      }
      this.masterSecret = Buffer.from(raw, "utf8");
      this.log.log("APP_SECRET validiert (production-Mode).");
      return;
    }

    // ── Dev/Test ──────────────────────────────────────────────────
    if (raw && raw.length >= 32 && !WEAK_VALUES.includes(raw)) {
      this.masterSecret = Buffer.from(raw, "utf8");
      return;
    }
    // Generierter Fallback: jeder Boot bekommt ein anderes Secret.
    // Dadurch sind verschlüsselte Werte aus früheren Dev-Boots NICHT
    // mehr lesbar — das ist gewollt, weil es nie für Persistenz
    // gedacht war.
    this.masterSecret = randomBytes(32);
    this.log.warn(
      "APP_SECRET nicht gesetzt — verwende einen *flüchtigen* Boot-Schlüssel. " +
        "Verschlüsselte Daten (z.B. SMTP-Passwort) bleiben nur bis zum nächsten Neustart lesbar. " +
        "Für Persistenz: APP_SECRET in der Umgebung setzen."
    );
  }

  /**
   * Leitet einen 32-Byte-Schlüssel für einen konkreten Zweck ab.
   * Identische `purpose` → identischer Schlüssel (deterministisch).
   * Verschiedene `purpose` → kryptografisch unabhängige Schlüssel.
   *
   * Anwender-Code soll den Schlüssel niemals in Variablen außerhalb
   * der eigenen Methode persistieren — die Cache-Hand-out ist eine
   * Buffer-Referenz; mutiert NIE den Buffer.
   */
  derive(purpose: SecretPurpose): Buffer {
    if (!this.masterSecret) {
      throw new Error(
        "AppSecretService.derive() vor onModuleInit aufgerufen — DI-Reihenfolge prüfen."
      );
    }
    const cached = this.cache.get(purpose);
    if (cached) return cached;
    // HKDF-SHA-256, 32-Byte-Output. Salt fix-leer (RFC 5869 empfiehlt
    // optional zufälliges Salt, aber für In-App-Domain-Separation reicht
    // ein deterministisches Schema, sonst wäre der Sub-Key pro Boot
    // anders).
    const out = hkdfSync(
      "sha256",
      this.masterSecret,
      Buffer.alloc(0), // salt
      Buffer.from(`jass-app/v1/${purpose}`, "utf8"), // info
      32
    );
    const buf = Buffer.from(out); // ArrayBuffer → Buffer copy
    this.cache.set(purpose, buf);
    return buf;
  }
}
