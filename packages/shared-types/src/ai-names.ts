/**
 * **KI-Spielernamen — deterministischer Generator (FE ↔ BE geteilt).**
 *
 * KI-Sitze haben keine echten Accounts; statt „KI · heuristic" bekommen sie
 * einen thematischen Namen. Der Name wird per Hash aus einem Seed gewählt
 * (`<tableId>:<seat>`) — dadurch ist er für einen Tisch stabil, an allen
 * UI-Stellen gleich und live wie im Archiv identisch.
 *
 * **Warum hier (shared-types)?** Diese Logik braucht sowohl das Frontend
 * (Anzeige) als auch das Backend (`aiDisplayName` beim Spielstart einfrieren).
 * Eine einzige Quelle verhindert, dass live- und gespeicherter Name drift.
 *
 * **Reihenfolge der Listen NICHT ändern** ohne Grund: Der Index ergibt sich aus
 * `hash(seed) % length` — eine Umsortierung würde alle generierten Namen
 * verschieben (gespeicherte `aiDisplayName` bleiben stabil, aber Alt-Spiele
 * ohne gespeicherten Namen würden neu gewürfelt).
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
 * mit 🤖-Präfix. `seed` ist i.d.R. `<tableId>:<seat>`.
 */
export function aiName(seed: string, aiSeatType: string | null | undefined): string {
  const isNn = typeof aiSeatType === "string" && aiSeatType.startsWith("nn");
  const list = isNn ? AI_NAMES_SCIFI : AI_NAMES_FANTASY;
  return `🤖 ${list[hashString(seed) % list.length]!}`;
}
