import { Controller, Get } from "@nestjs/common";

/**
 * Öffentliche (login-freie) Laufzeit-Konfiguration fürs Frontend.
 *
 * Aktuell nur der **Konto-Freischaltungs-Modus**, damit Register/Login die
 * passende Meldung zeigen:
 *   - `"email"` (Default) — Bestätigungslink per E-Mail.
 *   - `"admin"` (LAN-Mode) — ein Admin schaltet das Konto im Panel frei;
 *     es wird keine Mail verschickt.
 *
 * Bewusst ohne Auth-Guard (das Frontend braucht es vor dem Login). Enthält
 * nur unkritische, ohnehin-sichtbare Flags — keine Secrets.
 */
@Controller("config")
export class ConfigController {
  @Get()
  publicConfig(): { accountActivation: "email" | "admin" } {
    return {
      accountActivation: process.env["ACCOUNT_ACTIVATION"] === "admin" ? "admin" : "email",
    };
  }
}
