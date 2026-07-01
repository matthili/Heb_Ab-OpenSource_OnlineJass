/**
 * REST-Endpunkte fürs Web-Push-Subscribe-Setup.
 *
 *   - GET  /api/push/public-key  — VAPID-Public-Key für `pushManager.subscribe`
 *   - POST /api/push/subscribe   — Subscription am Server registrieren
 *   - POST /api/push/unsubscribe — Subscription wieder entfernen
 *
 * Der Server *sendet* Push automatisch (z.B. bei Join-Request) — der
 * Frontend-User muss nur einmal subscriben.
 */
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe.js";
import { PushService } from "./push.service.js";

// Bekannte Web-Push-Anbieter der gängigen Browser. Suffix-Match, weil manche
// Anbieter (v.a. Windows/WNS) die Subdomain pro Push-Server rotieren lassen
// (z.B. wns2-par02p.notify.windows.com).
const TRUSTED_PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge (Chromium), Android
  "push.services.mozilla.com", // Firefox (z.B. updates.push.services.mozilla.com)
  "notify.windows.com", // Windows/Legacy-Edge (WNS)
  "push.apple.com", // Safari (web.push.apple.com)
];

/**
 * Verhindert, dass ein Spieler eine beliebige URL als Push-Endpoint
 * registriert. Ohne diese Prüfung würde der Server bei jedem ausgelösten
 * Push (`PushService.sendToUser`) serverseitig einen Request an eine vom
 * Client frei wählbare URL schicken (SSRF-artig) — hier auf bekannte
 * Browser-Push-Anbieter eingeschränkt (Sicherheitsaudit 2026-06-30).
 */
function isTrustedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return TRUSTED_PUSH_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
  );
}

const SubscribeDtoSchema = z
  .object({
    endpoint: z
      .string()
      .min(1)
      .max(2048)
      .refine(isTrustedPushEndpoint, "Unbekannter Push-Anbieter."),
    keys: z
      .object({
        p256dh: z.string().min(1).max(512),
        auth: z.string().min(1).max(512),
      })
      .strict(),
    userAgent: z.string().max(255).optional(),
  })
  .strict();
type SubscribeDto = z.infer<typeof SubscribeDtoSchema>;

const UnsubscribeDtoSchema = z.object({ endpoint: z.string().min(1).max(2048) }).strict();
type UnsubscribeDto = z.infer<typeof UnsubscribeDtoSchema>;

@Controller("api/push")
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get("public-key")
  getPublicKey(): { publicKey: string | null; enabled: boolean } {
    return { publicKey: this.push.getPublicKey(), enabled: this.push.isEnabled };
  }

  @Post("subscribe")
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async subscribe(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(SubscribeDtoSchema)) dto: SubscribeDto
  ): Promise<void> {
    await this.push.register(req.user!.id, {
      endpoint: dto.endpoint,
      keys: dto.keys,
      ...(dto.userAgent ? { userAgent: dto.userAgent } : {}),
    });
  }

  @Post("unsubscribe")
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async unsubscribe(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(UnsubscribeDtoSchema)) dto: UnsubscribeDto
  ): Promise<void> {
    await this.push.unregister(req.user!.id, dto.endpoint);
  }
}
