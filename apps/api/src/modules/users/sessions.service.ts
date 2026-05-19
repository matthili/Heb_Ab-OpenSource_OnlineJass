/**
 * **Aktive Sessions verwalten** — User-Self-Service für „Wo bin ich
 * überall eingeloggt?" + „Diese fremde Sitzung abmelden".
 *
 * Better Auth speichert pro Login eine Row in `Session` (eigene DB-
 * Tabelle, nicht im Cookie). Wir lesen sie direkt mit Prisma, statt
 * über Better Auths interne API — die DB ist die Source-of-Truth, und
 * der Cookie-Cache (5 min) muss eh erst ablaufen, bis ein revoked
 * Cookie endgültig wertlos wird.
 *
 * **Sicherheits-Punkte:**
 *   - Bei `revoke(sessionId)` MUSS ein Ownership-Check laufen — sonst
 *     könnte User A die Session von User B löschen.
 *   - Die *aktuelle* Session des Callers darf hier NICHT widerrufen
 *     werden (würde den Caller mitten im Request abmelden + 401 für
 *     die nächste Antwort). Logout läuft über Better Auths eigene
 *     `/sign-out`-Route.
 *   - IP-Adressen werden NUR anonymisiert (/24 für IPv4, /48 für IPv6)
 *     ausgegeben — keine Stalking-Möglichkeit selbst über das eigene
 *     Profil.
 */
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

export interface SessionView {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  /** „Browser, Betriebssystem"-String (kann null sein, wenn UA fehlte). */
  userAgent: string | null;
  /** Anonymisierter IP-Prefix oder null. */
  ipPrefix: string | null;
  /** True für die Session, die diesen Request macht. */
  current: boolean;
}

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, currentSessionId: string): Promise<SessionView[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent ?? null,
      ipPrefix: anonymizeIp(s.ipAddress),
      current: s.id === currentSessionId,
    }));
  }

  async revoke(userId: string, sessionId: string, currentSessionId: string): Promise<void> {
    if (sessionId === currentSessionId) {
      throw new ForbiddenException(
        "Die eigene aktuelle Sitzung kann hier nicht widerrufen werden — bitte regulär ausloggen."
      );
    }
    const sess = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!sess) throw new NotFoundException("Session nicht gefunden");
    if (sess.userId !== userId) {
      // Information-Disclosure vermeiden: gleiche Antwort wie „nicht
      // gefunden", damit kein Angreifer fremde Session-IDs durchprobieren
      // und Treffer/Nicht-Treffer unterscheiden kann.
      throw new NotFoundException("Session nicht gefunden");
    }
    await this.prisma.session.delete({ where: { id: sessionId } });
  }

  async revokeAllOthers(userId: string, currentSessionId: string): Promise<{ revoked: number }> {
    const result = await this.prisma.session.deleteMany({
      where: { userId, NOT: { id: currentSessionId } },
    });
    return { revoked: result.count };
  }
}

/**
 * IPv4: /24-Prefix („192.168.1.0/24"). IPv6: /48-Prefix.
 * Bei ungültigem Input → null.
 *
 * /24 ist ein akzeptables Compromise: grob genug, dass selbst Familien-
 * Haushalte hinter einer NAT-IP nicht auf den Spieler-Block geschlossen
 * werden können; präzise genug, dass „selber Standort" für den User
 * erkennbar ist.
 */
function anonymizeIp(raw: string | null): string | null {
  if (!raw) return null;
  // IPv6 grob daran erkennen, dass Doppelpunkte vorkommen.
  if (raw.includes(":")) {
    // Nimm die ersten 3 Hextets (jeweils 16 Bit = /48).
    const parts = raw.split(":").slice(0, 3);
    if (parts.length < 3) return null;
    return `${parts.join(":")}::/48`;
  }
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}
