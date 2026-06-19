/**
 * Chat-Wortfilter (Moderation).
 *
 * Admin pflegt eine Liste verbotener Begriffe (`BannedWord`); jede gesendete
 * Chat-Nachricht (LOBBY/GAME/DM) wird vor der Sanitization durchsucht. Treffer
 * werden im Body durch `***` ersetzt (Maskierung statt Reject — der Schreiber
 * sieht, was er getippt hat, und kann umformulieren; ohne Frust durch
 * verschluckte Nachrichten).
 *
 * **Zwei Eintrags-Arten**:
 *   - Literal (`isRegex=false`, Default): case-insensitiver Substring-Match.
 *     „Scheiß" filtert auch „SCHEISS-Spiel". RegEx-Metazeichen werden escaped.
 *   - Regex (`isRegex=true`): RE2-Muster (eingeschränktes Regex via `re2js`).
 *     RE2 läuft in garantierter Linearzeit — kein ReDoS (katastrophales
 *     Backtracking), egal was der Admin einträgt. Unterstützt \w \d \s \b,
 *     Zeichenklassen, Gruppen, Quantifizierer; NICHT Rückbezüge/Lookaround
 *     (genau die Backtracking-Treiber). Gematcht wird ZEILENWEISE, damit ein
 *     Treffer nie über \r/\n reicht; `.` quert bei RE2 ohnehin kein \n.
 *
 * **Caching**: bewusst keins. Die Liste ist klein (typisch < 100 Einträge),
 * Chat-Nachrichten sind nicht hochfrequent, und Admin-Änderungen sollen
 * sofort wirken (Konsistenz > Mikro-Performance).
 */
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { RE2JS } from "re2js";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface BannedWordView {
  word: string;
  reason: string | null;
  isRegex: boolean;
  createdAt: string;
}

/** Match-relevanter Teil eines Eintrags (für `maskMessage`). */
export interface BannedPattern {
  word: string;
  isRegex: boolean;
}

export interface FilterResult {
  /** Body nach Maskierung. Identisch zum Original, falls keine Treffer. */
  clean: string;
  /** Welche Einträge wurden mindestens einmal getroffen (unique). */
  matched: string[];
}

const MAX_PATTERN_LEN = 200;

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
      isRegex: r.isRegex,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async add(
    actorId: string,
    rawWord: string,
    reason: string | null,
    isRegex: boolean
  ): Promise<void> {
    // Literale werden lowercase gespeichert (case-insensitiver Substring);
    // Regex-Muster bleiben unverändert (Case läuft über das i-Flag).
    const word = isRegex ? rawWord.trim() : rawWord.trim().toLowerCase();
    if (word.length === 0) {
      throw new ConflictException("Eintrag darf nicht leer sein.");
    }
    if (word.length > MAX_PATTERN_LEN) {
      throw new ConflictException(`Eintrag zu lang (max. ${MAX_PATTERN_LEN} Zeichen).`);
    }
    if (isRegex) {
      const err = validateRegexPattern(word);
      if (err) throw new ConflictException(err);
    }
    const existing = await this.prisma.bannedWord.findUnique({ where: { word } });
    if (existing) {
      throw new ConflictException(`Eintrag "${word}" steht bereits auf der Liste.`);
    }
    await this.prisma.bannedWord.create({
      data: { word, isRegex, ...(reason ? { reason } : {}) },
    });
    await this.audit.record({
      action: "admin.bannedwords.add",
      actorId,
      target: word,
      meta: { reason, isRegex },
    });
  }

  async remove(actorId: string, word: string): Promise<void> {
    // Literale sind lowercase gespeichert, Regex-Muster nicht — daher erst
    // exakt löschen, dann (nur falls nötig) den lowercase-Versuch für Literale.
    const exact = word.trim();
    const removed =
      (await this.prisma.bannedWord.delete({ where: { word: exact } }).catch(() => null)) ??
      (await this.prisma.bannedWord
        .delete({ where: { word: exact.toLowerCase() } })
        .catch(() => null));
    if (!removed) throw new NotFoundException(`Eintrag "${exact}" nicht gefunden.`);
    await this.audit.record({
      action: "admin.bannedwords.remove",
      actorId,
      target: removed.word,
    });
  }

  /**
   * Filtert einen Body. Lädt die aktuelle Liste, ersetzt jeden Treffer durch
   * `***`. Returnt den (möglicherweise unveränderten) Body + die gematchten
   * Einträge — der Caller (ChatService) protokolliert Treffer ins Audit-Log.
   */
  async filter(body: string): Promise<FilterResult> {
    const rows = await this.prisma.bannedWord.findMany({
      select: { word: true, isRegex: true },
    });
    return maskMessage(body, rows);
  }
}

/**
 * Prüft ein RE2-Muster vor dem Speichern. Liefert eine Fehlermeldung oder null.
 * `re2js` wirft bei ungültigen oder nicht unterstützten Mustern (Rückbezüge,
 * Lookaround). Zusätzlich lehnen wir Muster ab, die auf den Leerstring passen
 * (z.B. `a*`) — die würden sonst überall „***" einstreuen.
 */
export function validateRegexPattern(pattern: string): string | null {
  let compiled: RE2JS;
  try {
    compiled = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Ungültiges oder nicht unterstütztes Muster: ${msg}`;
  }
  if (compiled.matcher("").find()) {
    return "Muster darf nicht auf den Leerstring passen (z.B. „a*“ ist zu weitläufig).";
  }
  return null;
}

/**
 * Reine Filter-Logik, exportiert für Unit-Tests. Literale: case-insensitiver
 * Substring → `***`. Regex: RE2, zeilenweise (ein Treffer überschreitet nie
 * \r/\n).
 */
export function maskMessage(body: string, patterns: readonly BannedPattern[]): FilterResult {
  let result = body;
  const matched = new Set<string>();
  for (const { word, isRegex } of patterns) {
    if (word.length === 0) continue;
    if (isRegex) {
      const { next, hit } = maskRegexPerLine(result, word);
      if (hit) {
        matched.add(word);
        result = next;
      }
    } else {
      const re = new RegExp(escapeRegex(word), "gi");
      if (re.test(result)) {
        matched.add(word.toLowerCase());
        result = result.replace(new RegExp(escapeRegex(word), "gi"), "***");
      }
    }
  }
  return { clean: result, matched: [...matched] };
}

/**
 * Wendet ein RE2-Muster zeilenweise an. Der Split behält die Trenner (\r\n,
 * \r, \n) als eigene Array-Elemente, sodass nur die Inhalts-Segmente (gerade
 * Indizes) ersetzt und danach 1:1 wieder zusammengesetzt werden — ein Treffer
 * kann so strukturell keinen Zeilenumbruch überspannen.
 */
function maskRegexPerLine(text: string, pattern: string): { next: string; hit: boolean } {
  let compiled: RE2JS;
  try {
    compiled = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
  } catch {
    return { next: text, hit: false }; // defensiv — gespeicherte Muster sind validiert
  }
  const parts = text.split(/(\r\n|\r|\n)/);
  let hit = false;
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i];
    if (!seg) continue;
    const replaced = compiled.matcher(seg).replaceAll("***");
    if (replaced !== seg) {
      hit = true;
      parts[i] = replaced;
    }
  }
  return { next: parts.join(""), hit };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
