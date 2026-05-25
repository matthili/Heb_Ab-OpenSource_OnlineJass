/**
 * Globale Lobby-Einstellungen — pflegbar im Admin-Panel.
 *
 * Speichert drei Werte als `AdminSetting`-Zeilen (Schlüssel `lobby.*`):
 *   - `maxOpenTables`        — Sicherheits-Cap auf gleichzeitig aktive Tische
 *                              (WAITING + IN_GAME + POST_GAME)
 *   - `maxSeatsPerTable`     — Hard-Cap auf Sitzzahl pro Variante (heute
 *                              KREUZ_4P/SOLO_4P = 4, BODENSEE_2P = 2,
 *                              KREUZ_6P später 6 → Default 6 deckt alles ab)
 *   - `defaultPointsTarget`  — Fallback-Punkte-Ziel, wenn der Tisch-Eröffner
 *                              kein eigenes `targetScore` angibt
 *
 * Spec-Ursprung: „Globale Einstellungen: max. Tische gleichzeitig, max.
 * Spieler-Anzahl je Tisch, Default-Punkte-Ziel" (Ursprungsanforderung §1).
 *
 * Fallback-Werte unten greifen, solange in der DB kein Wert existiert —
 * eine frische Installation funktioniert also ohne Admin-Setup.
 */
import { Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface LobbySettings {
  maxOpenTables: number;
  maxSeatsPerTable: number;
  defaultPointsTarget: number;
}

export interface LobbySettingsUpdate {
  maxOpenTables?: number | undefined;
  maxSeatsPerTable?: number | undefined;
  defaultPointsTarget?: number | undefined;
}

const KEY = {
  maxOpenTables: "lobby.maxOpenTables",
  maxSeatsPerTable: "lobby.maxSeatsPerTable",
  defaultPointsTarget: "lobby.defaultPointsTarget",
} as const;

export const LOBBY_SETTINGS_DEFAULTS: LobbySettings = {
  maxOpenTables: 100,
  maxSeatsPerTable: 6,
  defaultPointsTarget: 1000,
};

@Injectable()
export class LobbySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /** Lädt alle drei Werte; fehlende Keys fallen auf Defaults zurück. */
  async getAll(): Promise<LobbySettings> {
    const rows = await this.prisma.adminSetting.findMany({
      where: { key: { in: Object.values(KEY) } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    return {
      maxOpenTables: readPositiveInt(
        byKey.get(KEY.maxOpenTables),
        LOBBY_SETTINGS_DEFAULTS.maxOpenTables
      ),
      maxSeatsPerTable: readPositiveInt(
        byKey.get(KEY.maxSeatsPerTable),
        LOBBY_SETTINGS_DEFAULTS.maxSeatsPerTable
      ),
      defaultPointsTarget: readPositiveInt(
        byKey.get(KEY.defaultPointsTarget),
        LOBBY_SETTINGS_DEFAULTS.defaultPointsTarget
      ),
    };
  }

  /**
   * Aktualisiert nur die im `update` mitgegebenen Felder. Schreibt einen
   * Audit-Eintrag mit den effektiv geänderten Keys.
   */
  async update(actorId: string, update: LobbySettingsUpdate): Promise<void> {
    const changed: Record<string, number> = {};
    for (const field of Object.keys(KEY) as (keyof LobbySettings)[]) {
      const v = update[field];
      if (typeof v !== "number") continue;
      const key = KEY[field];
      await this.prisma.adminSetting.upsert({
        where: { key },
        create: { key, value: { value: v }, updatedBy: actorId },
        update: { value: { value: v }, updatedBy: actorId },
      });
      changed[field] = v;
    }
    if (Object.keys(changed).length === 0) return;
    await this.audit.record({
      action: "admin.lobbySettings.update",
      actorId,
      meta: changed,
    });
  }
}

/**
 * Robustes Lesen aus dem JSONB-Blob `{ value: <number> }`. Bei kaputten oder
 * fehlenden Einträgen fällt die Funktion auf den Default zurück — niemals
 * Bug-induzierte Lobby-Sperre durch Schrott in der DB.
 */
function readPositiveInt(raw: unknown, fallback: number): number {
  if (raw && typeof raw === "object" && "value" in raw) {
    const v = (raw as { value: unknown }).value;
    if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0) {
      return v;
    }
  }
  return fallback;
}
