/**
 * Email-Blocklist.
 *
 * Pattern-Syntax (im `Blocklist.pattern`-Feld):
 *   - Beginnt mit `@`         → Domain-Suffix-Match (case-insensitive).
 *                                 z.B. `@example.com` blockt `alice@example.com`,
 *                                 `bob@example.com`, …
 *   - Enthält `*`             → Glob-Pattern; `*` matched beliebigen Text.
 *                                 z.B. `*+spam@*` blockt `alice+spam@anywhere.tld`
 *   - Sonst                    → exakte Adress-Übereinstimmung (case-insensitive).
 *
 * Blockliste-Treffer werden im Audit-Log mitprotokolliert (siehe AuthService-
 * Hook), damit Admins sehen, wann ein Block tatsächlich gegriffen hat.
 */
import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

export interface BlocklistMatch {
  blocked: boolean;
  pattern?: string;
  reason?: string | null;
}

@Injectable()
export class BlocklistService {
  private readonly log = new Logger(BlocklistService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prüft eine E-Mail-Adresse gegen alle Patterns in der Blocklist.
   * Liefert das erste Treffer-Pattern (es kann mehrere geben, aber für die
   * Abweisungs-Logik reicht eins).
   */
  async check(email: string): Promise<BlocklistMatch> {
    const normalized = email.trim().toLowerCase();
    const patterns = await this.prisma.blocklist.findMany();
    for (const entry of patterns) {
      if (matchesPattern(normalized, entry.pattern)) {
        this.log.debug({ email: normalized, pattern: entry.pattern }, "blocklist hit");
        return { blocked: true, pattern: entry.pattern, reason: entry.reason };
      }
    }
    return { blocked: false };
  }
}

/**
 * Reine Pattern-Match-Logik — exportiert für Unit-Tests, damit wir die nicht
 * gegen eine echte DB testen müssen. Normalisiert beide Argumente
 * (trim + lowercase), sodass Patterns wie `@Spam.Example` und Emails wie
 * `Alice@SPAM.example` korrekt matchen.
 */
export function matchesPattern(email: string, pattern: string): boolean {
  const e = email.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();

  if (p.startsWith("@")) {
    return e.endsWith(p);
  }
  if (p.includes("*")) {
    return globToRegex(p).test(e);
  }
  return e === p;
}

/**
 * Konvertiert Glob-Pattern zu Regex.
 * `*` → `.*`, andere Sonderzeichen werden escaped.
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$");
}
