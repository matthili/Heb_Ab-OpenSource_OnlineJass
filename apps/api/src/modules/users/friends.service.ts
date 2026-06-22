/**
 * Freundschafts-Logik. Eine Freundschaft existiert im DB-Schema in
 * **einer** Richtung (Requester → Addressee), wir behandeln sie aber
 * funktional als symmetrisch — `friend-status` und alle Operationen
 * suchen in beiden Richtungen.
 *
 * Statemachine (aus Sicht des Callers):
 *
 *   NONE         — keine Friendship-Row vorhanden
 *   PENDING_OUT  — ich habe angefragt, der andere muss bestätigen
 *   PENDING_IN   — der andere hat angefragt, ich muss bestätigen
 *   ACCEPTED     — wir sind befreundet
 *   BLOCKED      — eine Seite hat blockiert (zurzeit nur DB-Wert,
 *                  noch kein UI; Server liefert dann meist 404 statt
 *                  Detail-View, damit Profil-Stalking erschwert wird)
 *
 * Idempotenz: doppeltes `request` (wenn schon PENDING) ist no-op; doppeltes
 * `delete` (wenn schon NONE) ist no-op; `accept` ohne PENDING_IN wirft.
 */
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { FriendshipStatus } from "@prisma/client";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FriendsGateway } from "./friends.gateway.js";
import { resolveVisibility, type VisibilityMap } from "./visibility.js";

export type FriendStatusOut = "NONE" | "PENDING_OUT" | "PENDING_IN" | "ACCEPTED" | "BLOCKED";

export interface FriendListEntry {
  id: string;
  name: string;
  avatarUrl: string | null;
  since: Date;
}

export interface FriendsList {
  accepted: FriendListEntry[];
  pendingIn: FriendListEntry[]; // Anfragen an mich
  pendingOut: FriendListEntry[]; // Anfragen von mir
}

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gateway: FriendsGateway
  ) {}

  async getStatus(meId: string, otherId: string): Promise<FriendStatusOut> {
    if (meId === otherId) return "NONE";
    const f = await this.findEither(meId, otherId);
    if (!f) return "NONE";
    if (f.status === "BLOCKED") return "BLOCKED";
    if (f.status === "ACCEPTED") return "ACCEPTED";
    // PENDING — Richtung entscheidet
    return f.requesterId === meId ? "PENDING_OUT" : "PENDING_IN";
  }

  async sendRequest(meId: string, otherId: string): Promise<void> {
    if (meId === otherId) {
      throw new BadRequestException("Selbst-Freundschaft nicht erlaubt.");
    }
    const other = await this.prisma.user.findUnique({
      where: { id: otherId },
      select: { id: true, status: true },
    });
    if (!other || other.status !== "ACTIVE") {
      throw new BadRequestException("Empfänger existiert nicht oder ist inaktiv.");
    }
    const existing = await this.findEither(meId, otherId);
    if (existing) {
      if (existing.status === "ACCEPTED") {
        throw new ConflictException("Ihr seid bereits befreundet.");
      }
      if (existing.status === "PENDING") {
        // Bestehende PENDING — entweder von mir (no-op) oder vom anderen
        // (sollte er stattdessen `accept` rufen).
        if (existing.requesterId === meId) return;
        throw new ConflictException(
          "Es gibt bereits eine Anfrage von dieser Person — bitte annehmen statt neu anfragen."
        );
      }
      if (existing.status === "BLOCKED") {
        // Aus Privacy-Gründen geben wir nicht zu, dass es eine Block-
        // Beziehung gibt — wir schreiben dieselbe Fehlermeldung wie wenn
        // der User nicht aktiv wäre.
        throw new BadRequestException("Empfänger existiert nicht oder ist inaktiv.");
      }
    }
    await this.prisma.friendship.create({
      data: { requesterId: meId, addresseeId: otherId, status: "PENDING" },
    });
    await this.audit.record({
      action: "friend.request",
      actorId: meId,
      target: otherId,
    });
    // Empfänger live benachrichtigen — sonst sieht er die Anfrage nur, wenn er
    // zufällig sein Kontextmenü oder den Freunde-Tab öffnet.
    this.gateway.notifyRequestReceived(otherId, {
      fromId: meId,
      fromName: await this.displayName(meId),
    });
  }

  async accept(meId: string, otherId: string): Promise<void> {
    // Es muss eine PENDING-Row geben, in der ich der Addressee bin.
    const f = await this.prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: otherId, addresseeId: meId } },
    });
    if (!f || f.status !== "PENDING") {
      throw new BadRequestException("Keine offene Anfrage zum Annehmen.");
    }
    await this.prisma.friendship.update({
      where: { requesterId_addresseeId: { requesterId: otherId, addresseeId: meId } },
      data: { status: "ACCEPTED" },
    });
    await this.audit.record({
      action: "friend.accept",
      actorId: meId,
      target: otherId,
    });
    // Den ursprünglichen Anfrager (otherId) live über die Annahme informieren.
    this.gateway.notifyRequestAccepted(otherId, {
      fromId: meId,
      fromName: await this.displayName(meId),
    });
  }

  /**
   * Universal-Delete:
   *   - PENDING_OUT → Anfrage zurückziehen
   *   - PENDING_IN  → Anfrage ablehnen
   *   - ACCEPTED    → Entfreunden
   *   - NONE/BLOCKED → no-op
   */
  async remove(meId: string, otherId: string): Promise<void> {
    const f = await this.findEither(meId, otherId);
    if (!f || f.status === "BLOCKED") return;
    await this.prisma.friendship.delete({
      where: {
        requesterId_addresseeId: { requesterId: f.requesterId, addresseeId: f.addresseeId },
      },
    });
    await this.audit.record({
      action: `friend.${f.status === "ACCEPTED" ? "remove" : "cancel"}`,
      actorId: meId,
      target: otherId,
      meta: { previousStatus: f.status },
    });
  }

  /**
   * Liste meiner Freunde + offenen Anfragen. Für den Profile-„Freunde"-Tab.
   * Sortierung: alphabetisch nach Name innerhalb jeder Kategorie.
   */
  async listMine(meId: string): Promise<FriendsList> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: { not: "BLOCKED" },
        OR: [{ requesterId: meId }, { addresseeId: meId }],
      },
      include: {
        requester: { select: { id: true, name: true, profile: { select: { avatarUrl: true } } } },
        addressee: { select: { id: true, name: true, profile: { select: { avatarUrl: true } } } },
      },
    });

    const accepted: FriendListEntry[] = [];
    const pendingIn: FriendListEntry[] = [];
    const pendingOut: FriendListEntry[] = [];
    for (const r of rows) {
      const otherUser = r.requesterId === meId ? r.addressee : r.requester;
      const entry: FriendListEntry = {
        id: otherUser.id,
        name: otherUser.name,
        avatarUrl: otherUser.profile?.avatarUrl ?? null,
        since: r.createdAt,
      };
      if (r.status === "ACCEPTED") accepted.push(entry);
      else if (r.status === "PENDING") {
        if (r.requesterId === meId) pendingOut.push(entry);
        else pendingIn.push(entry);
      }
    }
    const byName = (a: FriendListEntry, b: FriendListEntry) => a.name.localeCompare(b.name);
    accepted.sort(byName);
    pendingIn.sort(byName);
    pendingOut.sort(byName);
    return { accepted, pendingIn, pendingOut };
  }

  /**
   * Freunde, die **heute** Geburtstag haben — für die dezente Erinnerung in
   * der Freunde-/Lobby-Ansicht. Respektiert die `birthDate`-Sichtbarkeit: ist
   * sie PRIVATE, taucht der Freund nicht auf (selbst Freunde sehen sie dann
   * nicht). Tag/Monat-Vergleich in Server-Zeit (regionale App, CET/CEST).
   */
  async birthdaysToday(meId: string): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: meId }, { addresseeId: meId }] },
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = rows.map((r) => (r.requesterId === meId ? r.addresseeId : r.requesterId));
    if (friendIds.length === 0) return [];

    const friends = await this.prisma.user.findMany({
      where: { id: { in: friendIds }, status: "ACTIVE" },
      select: { id: true, name: true, profile: { select: { birthDate: true, visibility: true } } },
    });

    const today = new Date();
    const m = today.getMonth();
    const d = today.getDate();
    const out: { id: string; name: string }[] = [];
    for (const f of friends) {
      const bd = f.profile?.birthDate;
      if (!bd) continue;
      const vis = (f.profile?.visibility ?? {}) as VisibilityMap;
      // Wir sind befreundet → FRIENDS/LOGGED_IN/PUBLIC sichtbar; nur PRIVATE nicht.
      if (resolveVisibility("birthDate", vis) === "PRIVATE") continue;
      const date = new Date(bd);
      if (date.getMonth() === m && date.getDate() === d) {
        out.push({ id: f.id, name: f.name });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /** Anzeigename für die Live-Benachrichtigung; leer, falls der User weg ist. */
  private async displayName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return u?.name ?? "";
  }

  /**
   * Findet die Friendship-Row zwischen zwei Usern unabhängig von der
   * Richtung. `@@id([requesterId, addresseeId])` heißt: max eine Zeile
   * pro Richtung. Wir suchen explizit beide.
   */
  private async findEither(
    a: string,
    b: string
  ): Promise<{
    requesterId: string;
    addresseeId: string;
    status: FriendshipStatus;
  } | null> {
    const f = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: a, addresseeId: b },
          { requesterId: b, addresseeId: a },
        ],
      },
      select: { requesterId: true, addresseeId: true, status: true },
    });
    return f;
  }
}
