/**
 * Profil-Konversations-History.
 *
 * Liefert zwei Sichten:
 *   1. **`listPartners`** — alle Personen, mit denen der eingeloggte User je
 *      DMs gewechselt hat, sortiert nach letztem Kontakt (jüngste zuerst).
 *      Pro Partner: letzte Nachricht (Vorschau + Zeit) + Flag „war während
 *      eines Spiels".
 *   2. **`getConversation`** — vollständiger DM-Verlauf zwischen User X und
 *      Partner Y, optional gefiltert nach Spiel-/Lobby-Kontext. Jede
 *      Nachricht mit `gameId` ist im Spiel-Kontext entstanden — der Aufrufer
 *      kriegt zusätzlich pro `gameId` die Liste der Mitspieler (`Spielername`
 *      für Menschen, `"KI (heuristic)"` o.ä. für KI-Sitze), damit das UI die
 *      Spec-Markierung „Während Partie #N, Mitspieler: …" rendern kann.
 *
 * Spec-Bezug: „Konversations-Übersicht" + „Filter: Nur Spielnachrichten /
 * Nur Lobby-Nachrichten / Alle" + Mitspieler-Anzeige beim Game-Kontext.
 *
 * **DM-Channel-Konvention**: `dm:<a>:<b>` mit `a < b` (alphabetisch). Der
 * `ChatService.send` schreibt es so; wir spiegeln das hier mit `dmChannelKey`.
 */
import { ForbiddenException, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

export interface ConversationPartner {
  partner: { id: string; name: string };
  lastMessage: {
    body: string;
    createdAt: string;
    /** `true` wenn die letzte Nachricht während eines aktiven Spiels geschickt wurde. */
    wasDuringGame: boolean;
  };
}

export interface ConversationMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string; // sanitized HTML
  createdAt: string;
  /** Wenn gesetzt: die Nachricht ist während dieses Spiels entstanden. */
  gameId: string | null;
}

export interface ConversationGameContext {
  /** Mitspieler-Namen am Tisch (Mensch-Spitzname oder z.B. `"KI (heuristic)"`). */
  mitspieler: string[];
}

export interface ConversationView {
  /** chronologisch aufsteigend (älteste zuerst), wie im UI gerendert. */
  messages: ConversationMessage[];
  /** `{ [gameId]: { mitspieler } }` — nur für die in `messages` referenzierten Games. */
  gameContexts: Record<string, ConversationGameContext>;
}

export type ConversationFilter = "all" | "during-game" | "no-game";

export interface ConversationOptions {
  filter: ConversationFilter;
  limit: number;
  /** ISO-Timestamp; nur Nachrichten älter als das laden (Pagination). */
  before?: string;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPartners(userId: string): Promise<ConversationPartner[]> {
    // Alle DM-Nachrichten ziehen, an denen der User beteiligt ist. Wir
    // erkennen Beteiligung am `channelKey` (enthält die User-ID), weil
    // `senderId` allein nur die HÄLFTE der Konversation findet (der andere
    // hätte uns gerade die letzte geschrieben).
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        channel: "DM",
        channelKey: { contains: userId },
      },
      orderBy: { createdAt: "desc" },
      select: {
        body: true,
        createdAt: true,
        channelKey: true,
        gameId: true,
      },
    });

    // Pro Partner nur den jüngsten Eintrag merken (rows ist desc).
    const byPartner = new Map<string, { body: string; createdAt: Date; gameId: string | null }>();
    for (const r of rows) {
      const partnerId = otherPartyOf(r.channelKey, userId);
      if (!partnerId) continue;
      if (byPartner.has(partnerId)) continue;
      byPartner.set(partnerId, {
        body: r.body,
        createdAt: r.createdAt,
        gameId: r.gameId,
      });
    }
    if (byPartner.size === 0) return [];

    const partnerIds = [...byPartner.keys()];
    const users = await this.prisma.user.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const out: ConversationPartner[] = [];
    for (const [partnerId, last] of byPartner) {
      out.push({
        partner: { id: partnerId, name: nameById.get(partnerId) ?? "[Gelöschter Spieler]" },
        lastMessage: {
          body: last.body,
          createdAt: last.createdAt.toISOString(),
          wasDuringGame: last.gameId !== null,
        },
      });
    }
    out.sort((a, b) => b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt));
    return out;
  }

  async getConversation(
    userId: string,
    partnerId: string,
    options: ConversationOptions
  ): Promise<ConversationView> {
    if (userId === partnerId) {
      throw new ForbiddenException("Self-DM ist nicht erlaubt.");
    }
    const channelKey = dmChannelKey(userId, partnerId);

    const gameIdFilter =
      options.filter === "during-game"
        ? { gameId: { not: null } }
        : options.filter === "no-game"
          ? { gameId: null }
          : {};

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        channelKey,
        ...gameIdFilter,
        ...(options.before ? { createdAt: { lt: new Date(options.before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit,
      include: { sender: { select: { id: true, name: true } } },
    });

    // Sammelt distinkte gameIds für die Mitspieler-Auflösung.
    const gameIds = [...new Set(rows.map((r) => r.gameId).filter((g): g is string => g !== null))];
    const gameContexts = await this.buildGameContexts(gameIds);

    // Älteste zuerst rendern (DB-Sort war desc für `take`-Limit).
    const messages: ConversationMessage[] = rows.reverse().map((r) => ({
      id: r.id.toString(),
      senderId: r.senderId,
      senderName: r.sender.name,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      gameId: r.gameId,
    }));

    return { messages, gameContexts };
  }

  private async buildGameContexts(
    gameIds: string[]
  ): Promise<Record<string, ConversationGameContext>> {
    if (gameIds.length === 0) return {};
    const seats = await this.prisma.gameSeat.findMany({
      where: { gameId: { in: gameIds } },
      select: {
        gameId: true,
        seat: true,
        aiSeatType: true,
        replacedByAiSeatType: true,
        user: { select: { name: true } },
      },
      orderBy: [{ gameId: "asc" }, { seat: "asc" }],
    });

    const byGame = new Map<string, string[]>();
    for (const s of seats) {
      const list = byGame.get(s.gameId) ?? [];
      // Mensch (war es nie KI-Anfangs- noch KI-Ersatz) → Spitzname.
      // KI-Sitz von Anfang an → "KI (typ)".
      // Mensch, der ausgestiegen ist (replacedByAiSeatType gesetzt) → Spitzname + "(KI-ersetzt)".
      let label: string;
      if (s.user) {
        label = s.replacedByAiSeatType ? `${s.user.name} (KI-ersetzt)` : s.user.name;
      } else if (s.aiSeatType) {
        label = `KI (${s.aiSeatType})`;
      } else {
        label = "—";
      }
      list.push(label);
      byGame.set(s.gameId, list);
    }
    const out: Record<string, ConversationGameContext> = {};
    for (const [gid, mitspieler] of byGame) {
      out[gid] = { mitspieler };
    }
    return out;
  }
}

/**
 * Bildet den DM-Channel-Key für ein User-Paar — alphabetisch geordnet, sodass
 * `dm:Alice:Bob` und `dm:Bob:Alice` denselben Kanal ergeben.
 */
export function dmChannelKey(a: string, b: string): string {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

/**
 * Aus einem `dm:<a>:<b>`-Key die ID des „anderen" Teilnehmers ziehen.
 * Returnt `null`, wenn der Key kaputt ist oder `me` keiner der beiden ist.
 */
function otherPartyOf(channelKey: string, me: string): string | null {
  const parts = channelKey.split(":");
  if (parts.length !== 3 || parts[0] !== "dm") return null;
  const a = parts[1];
  const b = parts[2];
  if (!a || !b) return null;
  if (a === me) return b;
  if (b === me) return a;
  return null;
}
