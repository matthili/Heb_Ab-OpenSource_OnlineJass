/**
 * Web-Push-Notifications.
 *
 * Spec: „Web-Push für 'Auf Anfrage'-Tische". Erste Konsumer-Stelle ist die
 * Lobby (Join-Request löst Push an den Tisch-Owner aus); das Service-Modul ist
 * aber generisch (`sendToUser`) und kann von beliebigen Stellen genutzt werden.
 *
 * **VAPID**: Server signiert jeden Push mit dem VAPID-Schlüsselpaar. Public
 * geht ins Frontend (für `pushManager.subscribe`), Private bleibt am Server.
 * Beide aus `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
 * Fehlt einer der drei, ist Push deaktiviert (`isEnabled === false`) — die App
 * läuft weiter, nur ohne Push.
 *
 * **Sub-Cleanup**: bei `410 Gone` (oder `404`) löscht der Service die
 * Subscription — der Browser hat sie revoziert.
 *
 * **Fail-open**: kein Throw in den Caller; ein DB- oder Push-Fehler wird nur
 * geloggt. Push ist eine Convenience, kein kritischer Pfad.
 */
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

import { PrismaService } from "../prisma/prisma.service.js";

export interface PushPayload {
  /** Notification-Titel. */
  title: string;
  /** Body-Text (eine Zeile genügt; Browser kürzen längere Texte). */
  body: string;
  /** Optionale URL — Service-Worker navigiert beim Klick dorthin. */
  url?: string;
  /** Optionales Icon (Pfad relativ zur App). */
  icon?: string;
  /** Optionales Tag — gleiche Tags ersetzen sich, statt zu stacken. */
  tag?: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger(PushService.name);
  private vapidPublicKey: string | null = null;
  private vapidPrivateKey: string | null = null;
  private vapidSubject: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const pub = process.env["VAPID_PUBLIC_KEY"]?.trim() || null;
    const priv = process.env["VAPID_PRIVATE_KEY"]?.trim() || null;
    const subject = process.env["VAPID_SUBJECT"]?.trim() || null;
    if (!pub || !priv || !subject) {
      this.log.log(
        "Web-Push deaktiviert (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT nicht alle gesetzt)."
      );
      return;
    }
    try {
      webpush.setVapidDetails(subject, pub, priv);
      this.vapidPublicKey = pub;
      this.vapidPrivateKey = priv;
      this.vapidSubject = subject;
      this.log.log("Web-Push aktiv (VAPID konfiguriert).");
    } catch (err) {
      this.log.error({ err }, "VAPID-Setup fehlgeschlagen — Push bleibt aus");
    }
  }

  /** `true` wenn VAPID konfiguriert ist und Push tatsächlich senden kann. */
  get isEnabled(): boolean {
    return (
      this.vapidPublicKey !== null && this.vapidPrivateKey !== null && this.vapidSubject !== null
    );
  }

  /** Liefert den Public-Key fürs Frontend (`pushManager.subscribe`). */
  getPublicKey(): string | null {
    return this.vapidPublicKey;
  }

  async register(userId: string, sub: PushSubscriptionInput): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        ...(sub.userAgent ? { userAgent: sub.userAgent } : {}),
      },
      update: {
        userId, // Re-Subscribe nach Account-Wechsel auf derselben Browser-Endpoint möglich.
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        ...(sub.userAgent ? { userAgent: sub.userAgent } : {}),
      },
    });
  }

  async unregister(userId: string, endpoint: string): Promise<void> {
    // userId-Filter schützt gegen das Abmelden fremder Subscriptions.
    await this.prisma.pushSubscription
      .deleteMany({ where: { endpoint, userId } })
      .catch(() => undefined);
  }

  /**
   * Schickt eine Push an alle aktiven Subscriptions des Users. Fail-open —
   * Fehler werden nur geloggt; tote Subs (410/404) werden gelöscht.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.isEnabled) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return;

    const json = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (row) => {
        const sub: WebPushSubscription = {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };
        try {
          await webpush.sendNotification(sub, json, { TTL: 60 });
          await this.prisma.pushSubscription.update({
            where: { id: row.id },
            data: { lastUsedAt: new Date() },
          });
        } catch (err: unknown) {
          const status = (err as { statusCode?: number } | null)?.statusCode;
          if (status === 410 || status === 404) {
            // Subscription beim Browser-Push-Service abgemeldet — wegwerfen.
            await this.prisma.pushSubscription
              .delete({ where: { id: row.id } })
              .catch(() => undefined);
            this.log.debug({ endpoint: row.endpoint }, "Push-Sub abgelaufen, entfernt");
          } else {
            this.log.warn(
              { err, status, userId, endpoint: row.endpoint },
              "Push-Send fehlgeschlagen"
            );
          }
        }
      })
    );
  }
}
