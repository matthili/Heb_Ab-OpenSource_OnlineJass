/**
 * **KI-Spielernamen — FE-Helfer.**
 *
 * Die eigentliche Namensgenerierung (Listen + Hash + `aiName`) lebt in
 * `@jass/shared-types`, damit Frontend (Anzeige) und Backend (`aiDisplayName`
 * beim Spielstart einfrieren) **dieselbe** Quelle nutzen — kein Drift zwischen
 * live angezeigtem und gespeichertem Namen. Hier bleiben nur die UI-nahen
 * Helfer (`seatDisplayName`, `shortName`, `aiSeatTooltip`).
 *
 * `aiName` + die Namenslisten werden re-exportiert, damit bestehende Importe
 * aus `~/features/game/aiNames` unverändert weiterlaufen.
 */
import { aiName, AI_NAMES_FANTASY, AI_NAMES_SCIFI } from "@jass/shared-types";

export { aiName, AI_NAMES_FANTASY, AI_NAMES_SCIFI };

/** Seat-artige Struktur (kompatibel mit `SeatView`). */
interface SeatLike {
  seat: number;
  user?: { name: string } | null | undefined;
  aiSeatType?: string | null | undefined;
  /** Eingefrorener KI-Name (falls persistiert) — hat Vorrang vor Generierung. */
  aiDisplayName?: string | null | undefined;
}

/**
 * Anzeigename für einen Sitz: Mensch → Spitzname; KI → gespeicherter Name
 * (falls vorhanden) sonst thematischer Name (🤖-Präfix); leerer Sitz →
 * `emptyFallback`. `seed` ist i.d.R. die `tableId` (stabil über alle Spiele
 * eines Tisches) — die Sitz-Nummer wird intern angehängt.
 */
export function seatDisplayName(seat: SeatLike, seed: string, emptyFallback = "—"): string {
  if (seat.user?.name) return seat.user.name;
  if (seat.aiDisplayName) return seat.aiDisplayName;
  if (seat.aiSeatType) return aiName(`${seed}:${seat.seat}`, seat.aiSeatType);
  return emptyFallback;
}

/**
 * Lange Spielernamen für knappe Anzeigen kürzen (z.B. „… hat gestochen"):
 * ab `max` Zeichen abschneiden und „…" anhängen. Lässt das echte Casing
 * unangetastet.
 */
export function shortName(name: string, max = 20): string {
  return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name;
}

/**
 * Tooltip-Text fürs 🤖-Icon eines KI-Sitzes: zeigt, welche Engine GERADE spielt.
 * Bei NN-Sitz + nicht erreichbarem Inferenz-Service → Hinweis auf den
 * Heuristik-Fallback (der Spielername bleibt davon unberührt). `t` wird
 * übergeben, damit dieses Util i18n-frei bleibt. Leerstring für Nicht-KI.
 */
export function aiSeatTooltip(
  t: (key: string) => string,
  aiSeatType: string | null | undefined,
  inferenceAvailable: boolean
): string {
  if (!aiSeatType) return "";
  if (aiSeatType.startsWith("nn")) {
    return inferenceAvailable ? t("game.aiEngine.nn") : t("game.aiEngine.nnFallback");
  }
  if (aiSeatType === "random") return t("game.aiEngine.random");
  return t("game.aiEngine.heuristic");
}
