/**
 * Cloudflare Turnstile — server-seitige Token-Verifikation.
 *
 * Turnstile-Flow:
 *   1. Frontend rendert das Widget (mit `TURNSTILE_SITE_KEY`).
 *   2. User löst (im Idealfall transparent, sonst Challenge) → Widget
 *      callbackt mit einem Token.
 *   3. Frontend hängt das Token an die Auth-Anfrage (Header `X-Turnstile-Token`
 *      oder Body-Feld `captchaToken`).
 *   4. Server verifiziert es bei Cloudflares Siteverify-Endpoint mit
 *      `TURNSTILE_SECRET_KEY` und der Client-IP.
 *   5. Bei `success: false` oder Tampering → Request abweisen.
 *
 * **Sicherheits-Eigenschaften der Verifikation:**
 *   - Token ist nur **einmal** einlösbar — wenn ein Angreifer ein Token
 *     auf der Wire abgreift und replay'd, lehnt Cloudflare beim zweiten
 *     Verify ab.
 *   - Token ist an die Client-IP gebunden (optional, aber wir nutzen es).
 *   - TTL ~5 Min — alte Tokens funktionieren nicht.
 *
 * **Dev-/Test-Bypass**: Wenn `TURNSTILE_SECRET_KEY` nicht gesetzt ist UND
 * `NODE_ENV !== production`, übersprigen wir die Prüfung (sonst wäre Dev
 * frustrierend). Production-Boot-Validation (`main.ts`) prüft separat,
 * dass das Secret gesetzt ist — oder dass `DISABLE_TURNSTILE=1` explizit
 * akzeptiert wird (kein-stilles-Aus).
 */
import { Injectable, Logger } from "@nestjs/common";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
}

export interface TurnstileVerifyResult {
  /** true: Token war frisch + gültig + einlösbar. false: irgendwas stimmte nicht. */
  ok: boolean;
  /** Cloudflare-Fehler-Codes (z.B. "missing-input-response", "timeout-or-duplicate"). */
  errors: readonly string[];
}

@Injectable()
export class TurnstileService {
  private readonly log = new Logger(TurnstileService.name);

  /**
   * Prüft, ob das Token gültig ist. Wenn `TURNSTILE_SECRET_KEY` nicht
   * gesetzt ist (Dev), liefern wir `ok: true` zurück — der Caller
   * entscheidet selbst, ob er das in production tolerieren will.
   */
  async verify(token: string | undefined, clientIp: string | null): Promise<TurnstileVerifyResult> {
    const secret = process.env["TURNSTILE_SECRET_KEY"];
    if (!secret) {
      // Dev-Bypass — Boot in production (main.ts) verbietet das.
      return { ok: true, errors: [] };
    }
    if (!token) {
      return { ok: false, errors: ["missing-input-response"] };
    }

    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (clientIp) form.set("remoteip", clientIp);

    try {
      const res = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        // Aggressive Timeout — bei Cloudflare-Outage soll der Login-Pfad
        // nicht 30 s hängen.
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.log.warn({ status: res.status }, "Turnstile siteverify lieferte Non-200");
        return { ok: false, errors: ["http-status-" + res.status] };
      }
      const json = (await res.json()) as SiteverifyResponse;
      if (json.success) return { ok: true, errors: [] };
      return { ok: false, errors: json["error-codes"] ?? ["unknown"] };
    } catch (err) {
      this.log.warn({ err }, "Turnstile siteverify Netzwerk-Fehler");
      // Im Fehler-Fall: **ablehnen**. Lieber legit Users kurz blocken
      // als bei Cloudflare-Ausfall plötzlich captcha-frei.
      return { ok: false, errors: ["network-error"] };
    }
  }
}
