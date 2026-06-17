/**
 * **KI-Spielernamen — rein kosmetischer „Gag".**
 *
 * KI-Sitze haben keine echten Accounts/Statistiken; statt „KI · heuristic"
 * bekommen sie hier einen thematischen Namen, damit der Tisch lebendiger wirkt.
 *
 * **Zwei Listen, nach KI-Typ:**
 *   - Heuristik/Random → Fantasy (Herr der Ringe, Robin Hood, Eragon, Zelda).
 *   - NN-basiert (`nn`, `nn-vX.Y.Z`) → SciFi (Star Trek, Matrix, Star Wars).
 *
 * **Deterministisch statt zufällig:** Der Name wird aus einem Seed
 * (`<gameId>:<seat>`) per Hash gewählt — dadurch ist er für eine Partie stabil
 * (kein Springen bei Re-Renders), an allen UI-Stellen identisch und sogar im
 * Replay derselbe (gleiche gameId → gleicher Name). Keine DB-/Schema-Änderung
 * nötig, da nichts persistiert werden muss.
 *
 * Ein kleines 🤖-Präfix bleibt erhalten, damit Mensch vs. KI klar bleibt.
 */

/** Fantasy-Namen für Heuristik-/Random-KI. */
export const AI_NAMES_FANTASY: readonly string[] = [
  // Herr der Ringe
  "Frodo",
  "Sam",
  "Gandalf",
  "Aragorn",
  "Legolas",
  "Gimli",
  "Boromir",
  "Merry",
  "Pippin",
  "Bilbo",
  "Galadriel",
  "Elrond",
  "Arwen",
  "Éowyn",
  "Éomer",
  "Théoden",
  "Faramir",
  "Saruman",
  "Gollum",
  "Baumbart",
  "Glorfindel",
  "Thranduil",
  "Radagast",
  "Haldir",
  "Bard",
  "Thorin",
  "Balin",
  "Dwalin",
  "Fíli",
  "Kíli",
  "Bombur",
  "Beorn",
  // Robin Hood
  "Robin Hood",
  "Little John",
  "Bruder Tuck",
  "Will Scarlet",
  "Marian",
  "Much",
  "Alan-a-Dale",
  "Guy von Gisbourne",
  // Eragon (Das Vermächtnis der Drachenreiter)
  "Eragon",
  "Saphira",
  "Brom",
  "Murtagh",
  "Arya",
  "Roran",
  "Nasuada",
  "Oromis",
  "Glaedr",
  "Angela",
  "Orik",
  "Elva",
  "Thorn",
  // The Legend of Zelda
  "Link",
  "Zelda",
  "Ganondorf",
  "Impa",
  "Midna",
  "Navi",
  "Sheik",
  "Darunia",
  "Ruto",
  "Saria",
  "Malon",
  "Epona",
  "Tetra",
  "Vaati",
  "Skull Kid",
  "Daruk",
  "Revali",
  "Mipha",
  "Urbosa",
  "Sidon",
  "Riju",
  "Groose",
];

/** SciFi-Namen für NN-basierte KI. */
export const AI_NAMES_SCIFI: readonly string[] = [
  // Star Trek — TOS
  "Kirk",
  "Spock",
  "Pille McCoy",
  "Scotty",
  "Uhura",
  "Sulu",
  "Chekov",
  // TNG
  "Picard",
  "Riker",
  "Data",
  "Worf",
  "Geordi",
  "Deanna Troi",
  "Beverly Crusher",
  "Wesley",
  "Tasha Yar",
  "Guinan",
  "Q",
  // DS9
  "Sisko",
  "Kira",
  "Odo",
  "Jadzia Dax",
  "Bashir",
  "Quark",
  "Garak",
  "Rom",
  "Nog",
  "Martok",
  "Dukat",
  // VOY
  "Janeway",
  "Chakotay",
  "Tuvok",
  "B'Elanna Torres",
  "Tom Paris",
  "Harry Kim",
  "Neelix",
  "Kes",
  "Seven of Nine",
  "Der Doktor",
  // ENT
  "Archer",
  "T'Pol",
  "Trip Tucker",
  "Malcolm Reed",
  "Hoshi",
  "Travis",
  "Phlox",
  // DISC / PIC
  "Michael Burnham",
  "Saru",
  "Tilly",
  "Stamets",
  // The Matrix
  "Neo",
  "Morpheus",
  "Trinity",
  "Agent Smith",
  "Cypher",
  "Niobe",
  "Das Orakel",
  "Der Architekt",
  "Merowinger",
  "Seraph",
  "Switch",
  "Mouse",
  // Star Wars
  "Luke",
  "Leia",
  "Han Solo",
  "Chewbacca",
  "Yoda",
  "Obi-Wan",
  "Darth Vader",
  "Palpatine",
  "R2-D2",
  "C-3PO",
  "Lando",
  "Boba Fett",
  "Admiral Ackbar",
  "Mace Windu",
  "Qui-Gon",
  "Padmé",
  "Anakin",
  "Rey",
  "Finn",
  "Poe",
  "Kylo Ren",
  "BB-8",
  "Din Djarin",
  "Grogu",
  "Ahsoka",
  "Thrawn",
  "Wedge",
];

/** Deterministischer String-Hash (djb2, als uint32). */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Wählt einen KI-Namen deterministisch aus dem Seed. NN-Typen (`nn…`) bekommen
 * SciFi-Namen, alles andere (heuristic/random) Fantasy-Namen. Liefert den Namen
 * mit 🤖-Präfix.
 */
export function aiName(seed: string, aiSeatType: string | null | undefined): string {
  const isNn = typeof aiSeatType === "string" && aiSeatType.startsWith("nn");
  const list = isNn ? AI_NAMES_SCIFI : AI_NAMES_FANTASY;
  return `🤖 ${list[hashString(seed) % list.length]!}`;
}

/** Seat-artige Struktur (kompatibel mit `SeatView`). */
interface SeatLike {
  seat: number;
  user?: { name: string } | null | undefined;
  aiSeatType?: string | null | undefined;
}

/**
 * Anzeigename für einen Sitz: Mensch → Spitzname; KI → thematischer Name
 * (🤖-Präfix); leerer Sitz → `emptyFallback`. `seed` ist i.d.R. die `gameId`
 * (für Replay-Konsistenz) — die Sitz-Nummer wird intern angehängt.
 */
export function seatDisplayName(seat: SeatLike, seed: string, emptyFallback = "—"): string {
  if (seat.user?.name) return seat.user.name;
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
