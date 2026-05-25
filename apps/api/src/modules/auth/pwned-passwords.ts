/**
 * Pwned-Passwords-Check (HaveIBeenPwned k-Anonymity Range-API).
 *
 * **Was wir prüfen**: Wurde das Passwort in einem bekannten Datenleck gesehen?
 * Wenn ja, ist es egal, wie „stark" es nach Entropie-Maßstab ist — Angreifer
 * laden Breach-Listen herunter und probieren sie als Erstes. Spec verlangt das
 * ausdrücklich („kein Hash-Re-Use im Sinne von HaveIBeenPwned-Check").
 *
 * **Wie es funktioniert (k-Anonymity)**:
 *   1. SHA-1-Hash des Passworts bilden (40 Hex-Zeichen).
 *   2. Die ersten 5 Zeichen ("Prefix") an `api.pwnedpasswords.com/range/<prefix>`
 *      schicken — nicht das ganze Hash. So sieht der HIBP-Server nie das
 *      Passwort selbst, nicht mal seinen vollen Hash.
 *   3. Antwort ist eine Liste aller passenden Suffixe ("HASH35:COUNT" pro Zeile)
 *      mit ihren Breach-Counts. Unsere Suffix-Match-Prüfung läuft lokal.
 *   4. Header `Add-Padding: true` lässt den Server Dummy-Zeilen anhängen,
 *      damit aus der Antwortgröße nicht der angefragte Prefix gerätselt werden
 *      kann (Schutz vor Traffic-Analysis).
 *
 * **Warum SHA-1, obwohl SHA-1 als Hash-Funktion „gebrochen" ist?** Hier dient
 * SHA-1 nur als Schlüssel-Lookup im k-Anonymity-Protokoll — nicht zum
 * Passwort-Speichern (das macht weiterhin Argon2id). Der Hash verlässt unseren
 * Server nur in den ersten 5 Zeichen; eine SHA-1-Kollision würde uns nichts
 * nützen, weil wir am Ende den vollen Suffix mit dem vollen API-Hash
 * vergleichen.
 *
 * **Fail-open-Semantik**: Netzwerk-Ausfall, Timeout, HIBP-API down → wir
 * **erlauben** das Passwort und loggen eine Warnung. Anderenfalls würde ein
 * Cloudflare-Outage bei HIBP unsere Sign-ups komplett blockieren — Verfügbarkeit
 * geht hier vor strikter Durchsetzung. Der zxcvbn-Check + Argon2id + Rate-Limit
 * sind die Hauptverteidigung; HIBP ist die zusätzliche Hürde.
 *
 * **Performance**: Eine HTTPS-Anfrage pro Sign-up/Reset (~150–500 ms).
 * Akzeptabel — diese Pfade sind nicht hochfrequent und der User wartet ohnehin.
 */
import { createHash } from "node:crypto";
import { Logger } from "@nestjs/common";

const log = new Logger("PwnedPasswords");

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const DEFAULT_TIMEOUT_MS = 1500;

export interface PwnedResult {
  /** `true` wenn das Passwort in einem bekannten Leck gefunden wurde. */
  pwned: boolean;
  /** Anzahl der bekannten Vorkommen (nur wenn `pwned`). */
  count?: number;
  /**
   * Bei Netzwerkfehler / Timeout: kurze Fehler-Beschreibung. `pwned` ist dann
   * `false` (Fail-open) — der Aufrufer soll das Passwort durchlassen, aber
   * den Vorfall ggf. loggen.
   */
  error?: "timeout" | "network" | "status" | "disabled";
}

export interface PwnedCheckOptions {
  /** Timeout in Millisekunden, default 1500. */
  timeoutMs?: number;
  /**
   * Eigene `fetch`-Implementierung (für Tests). Default: globale `fetch`
   * (Node 22+).
   */
  fetchImpl?: typeof fetch;
}

/**
 * Liefert SHA-1-Hash eines Strings als Uppercase-Hex (40 Zeichen) — das
 * Format, in dem die HIBP-Range-API ihre Suffix-Liste zurückgibt.
 */
function sha1Hex(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex").toUpperCase();
}

/**
 * Prüft das Passwort gegen die HIBP-Range-API. Per Default fail-open bei
 * Fehlern (siehe Modul-Doc). Mit `DISABLE_HIBP_CHECK=1` wird der Check ganz
 * übersprungen (Tests + lokale Dev-Convenience; in production verweigert
 * `assertNoUnsafeFlagsInProduction` diesen Wert).
 */
export async function checkPasswordBreached(
  password: string,
  options: PwnedCheckOptions = {}
): Promise<PwnedResult> {
  if (process.env["DISABLE_HIBP_CHECK"] === "1") {
    return { pwned: false, error: "disabled" };
  }
  if (typeof password !== "string" || password.length === 0) {
    return { pwned: false };
  }

  const hash = sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
      method: "GET",
      headers: {
        // Vom Server gewünscht — verhindert Traffic-Analysis über
        // Response-Größe (Padding bis ~1100 Zeilen).
        "Add-Padding": "true",
        // HIBP empfiehlt explizit, KEINE üblichen Browser-User-Agents zu
        // schicken; dieser Wert markiert die App eindeutig.
        "User-Agent": "vorarlberger-jass-app (security/hibp-check)",
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      log.warn({ status: res.status, prefix }, "HIBP-API antwortete non-2xx — fail-open");
      return { pwned: false, error: "status" };
    }
    const body = await res.text();
    // Antwort-Format: "SUFFIX:COUNT" je Zeile. Suffix ist case-insensitive
    // (HIBP liefert Uppercase, defensive trotzdem normalisieren).
    for (const line of body.split(/\r?\n/)) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const lineSuffix = line.slice(0, idx).trim().toUpperCase();
      if (lineSuffix === suffix) {
        const count = Number.parseInt(line.slice(idx + 1).trim(), 10);
        return Number.isFinite(count) ? { pwned: true, count } : { pwned: true };
      }
    }
    return { pwned: false };
  } catch (err) {
    const isAbort = (err as { name?: string } | null)?.name === "AbortError";
    log.warn(
      { err, prefix, kind: isAbort ? "timeout" : "network" },
      "HIBP-Check fehlgeschlagen — fail-open"
    );
    return { pwned: false, error: isAbort ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
