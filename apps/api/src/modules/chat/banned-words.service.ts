/**
 * Chat-Wortfilter (Moderation).
 *
 * Admin pflegt eine Liste verbotener Begriffe (`BannedWord`); jede gesendete
 * Chat-Nachricht (LOBBY/GAME/DM) wird vor der Sanitization durchsucht. Treffer
 * werden im Body durch `***` ersetzt (Maskierung statt Reject — der Schreiber
 * sieht, was er getippt hat, und kann umformulieren; ohne Frust durch
 * verschluckte Nachrichten).
 *
 * **Matching**:
 *   - Case-insensitive Substring-Match. „Scheiß" filtert auch „SCHEISS-Spiel"
 *     (sofern in der Liste eingetragen) — bewusst tolerant, weil deutsche
 *     Komposita keine sauberen Wortgrenzen haben. Admins können präzise
 *     Einträge nutzen, um false positives zu vermeiden.
 *   - Replacement immer feste 3 Sterne, unabhängig von Wortlänge. Markdown-
 *     freundlich (3 Sterne ohne umgebenden Text werden vom Renderer als
 *     literale Asterisks behandelt, nicht als Emphasis).
 *
 * **Caching**: bewusst keins. Die Liste ist klein (typisch < 100 Einträge),
 * Chat-Nachrichten sind nicht hochfrequent, und Admin-Änderungen sollen
 * sofort wirken (Konsistenz > Mikro-Performance).
 */
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface BannedWordView {
  word: string;
  reason: string | null;
  createdAt: string;
}

export interface FilterResult {
  /** Body nach Maskierung. Identisch zum Original, falls keine Treffer. */
  clean: string;
  /** Welche Wörter wurden mindestens einmal getroffen (lowercase, unique). */
  matched: string[];
}

@Injectable()
export class BannedWordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(): Promise<BannedWordView[]> {
    const rows = await this.prisma.bannedWord.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      word: r.word,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async add(actorId: string, word: string, reason: string | null): Promise<void> {
    const normalized = word.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new ConflictException("Wort darf nicht leer sein.");
    }
    const existing = await this.prisma.bannedWord.findUnique({ where: { word: normalized } });
    if (existing) {
      throw new ConflictException(`Wort "${normalized}" steht bereits auf der Liste.`);
    }
    await this.prisma.bannedWord.create({
      data: { word: normalized, ...(reason ? { reason } : {}) },
    });
    await this.audit.record({
      action: "admin.bannedwords.add",
      actorId,
      target: normalized,
      meta: { reason },
    });
  }

  async remove(actorId: string, word: string): Promise<void> {
    const normalized = word.trim().toLowerCase();
    const removed = await this.prisma.bannedWord
      .delete({ where: { word: normalized } })
      .catch(() => null);
    if (!removed) throw new NotFoundException(`Wort "${normalized}" nicht gefunden.`);
    await this.audit.record({
      action: "admin.bannedwords.remove",
      actorId,
      target: normalized,
    });
  }

  /**
   * Filtert einen Body. Lädt die aktuelle Liste, ersetzt jeden Treffer durch
   * `***`. Returnt den (möglicherweise unveränderten) Body + die gematchten
   * Wörter — der Caller (ChatService) protokolliert Treffer ins Audit-Log.
   */
  async filter(body: string): Promise<FilterResult> {
    const words = await this.prisma.bannedWord.findMany({
      select: { word: true },
    });
    return maskMessage(
      body,
      words.map((w) => w.word)
    );
  }
}

/**
 * Reine Filter-Logik, exportiert für Unit-Tests. Case-insensitive Substring-
 * Match, Ersatz durch `***` (3 feste Sterne, markdown-neutral).
 */
export function maskMessage(body: string, words: readonly string[]): FilterResult {
  let result = body;
  const matched = new Set<string>();
  for (const w of words) {
    if (w.length === 0) continue;
    const re = new RegExp(escapeRegex(w), "gi");
    if (re.test(result)) {
      matched.add(w.toLowerCase());
      result = result.replace(new RegExp(escapeRegex(w), "gi"), "***");
    }
  }
  return { clean: result, matched: [...matched] };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
