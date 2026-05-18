/**
 * Spielkarten-Komponente.
 *
 * **Asset-Quelle**: PNGs aus `assets/cards/`, vom Web-App per Build-Step
 * nach `public/cards/` kopiert. Dateiname-Schema: `{suit}-{rank}.png`,
 * WELI als Sonderfall `schelle-6-weli.png`.
 *
 * **Code-Identifier**: Wir behalten `isWeli` als Variablen-Namen
 * (Camel-Case-Konvention) — der Vergleichswert im sichtbaren UI ist
 * konsequent „WELI" geschrieben, im JS-Symbol bleibt's lesbar.
 *
 * **Rendering**: Die PNGs haben transparente abgerundete Ecken — wir
 * legen also **keinen** weißen Hintergrund und **keinen** Rahmen darunter.
 * Stattdessen nur ein Drop-Shadow, der die Karte vom Untergrund abhebt.
 * Hover/Focus heben die Karte leicht und verstärken den Schatten.
 *
 * **A11y**: Jede Karte hat ein `aria-label` mit der lesbaren Bezeichnung
 * (z.B. „Herz Bauer"). `role="button"` nur, wenn die Karte interaktiv ist
 * (`onClick` gesetzt); reine Render-Karten sind `role="img"`.
 *
 * **Disabled/Illegal**: Wenn `disabled` (z.B. nicht in der
 * `legalActionMask`), wird die Karte ausgegraut und kein Click triggert.
 *
 * **High-Contrast**: Wir nutzen Tailwind-CSS-Variablen, sodass ein
 * High-Contrast-Toggle (M11) die Ränder verstärken kann, ohne in den
 * Render-Code zu greifen.
 */
import type { Card as CardModel, Rank, Suit } from "@jass/engine";

export interface CardProps {
  card: CardModel;
  /** Wenn gesetzt: interaktiv (Button); sonst: rein dekorativ (Img). */
  onClick?: (card: CardModel) => void;
  /** Karte verdunkeln + Klick deaktivieren (für illegal-action-Anzeige). */
  disabled?: boolean;
  /** Visuell „angehoben" (z.B. hover/focus oder ausgewählt). */
  raised?: boolean;
  /** Größe — `md` ist Default, `sm` für die Trick-Anzeige in der Mitte. */
  size?: "xs" | "sm" | "md" | "lg";
  /** Optional: zusätzliche Klassen vom Caller. */
  className?: string;
}

const SUIT_LABEL: Record<Suit, string> = {
  EICHEL: "Eichel",
  SCHELLE: "Schelle",
  HERZ: "Herz",
  LAUB: "Laub",
};

const RANK_LABEL: Record<Rank, string> = {
  SECHS: "Sechs",
  SIEBEN: "Sieben",
  ACHT: "Acht",
  NEUN: "Neun",
  ZEHN: "Zehn",
  UNTER: "Bauer",
  OBER: "Ober",
  KOENIG: "König",
  ASS: "Ass",
};

const SUIT_FILE: Record<Suit, string> = {
  EICHEL: "eichel",
  SCHELLE: "schelle",
  HERZ: "herz",
  LAUB: "laub",
};

const RANK_FILE: Record<Rank, string> = {
  SECHS: "6",
  SIEBEN: "7",
  ACHT: "8",
  NEUN: "9",
  ZEHN: "10",
  UNTER: "U",
  OBER: "O",
  KOENIG: "K",
  ASS: "A",
};

// Karten-Größen — Höhe ist proportional zur Druck-Aspect-Ratio der PNGs
// (≈ 0,67). Wir setzen Höhe explizit, damit die Breite über `w-auto` aus
// dem Bild kommt und der Layout-Slot nicht eine eigene Aspect-Ratio
// erzwingt (sonst sieht man weiße Streifen oben/unten).
//
// **md-Größe (User-Wunsch)**: Hand UND Trick nutzen `md`. Wir haben das
// von h-36 auf h-32 reduziert, damit am Tisch liegende Karten kompakter
// wirken und damit die eigene Hand auch bei nur einer verbleibenden
// Karte nicht überdimensioniert auf dem Bildschirm steht.
const SIZE_CLASSES = {
  xs: "h-14", // Mini-Trick-Historie
  sm: "h-24", // Klein (Detail-Ansichten)
  md: "h-32", // Hand + Trick — beide gleich groß
  lg: "h-48", // Großdarstellung (Replay-Detail)
} as const;

export function Card(props: CardProps) {
  const { card, onClick, disabled = false, raised = false, size = "md", className = "" } = props;
  const interactive = Boolean(onClick) && !disabled;

  // Dateiname: Sonderfall WELI (Schelle-6) bekommt `schelle-6-weli.png`,
  // alle anderen folgen dem `{suit}-{rank}.png`-Schema.
  const isWeli = card.suit === "SCHELLE" && card.rank === "SECHS";
  const imgSrc = isWeli
    ? "/cards/schelle-6-weli.png"
    : `/cards/${SUIT_FILE[card.suit]}-${RANK_FILE[card.rank]}.png`;

  const label = `${SUIT_LABEL[card.suit]} ${RANK_LABEL[card.rank]}${isWeli ? " (WELI)" : ""}`;

  // Kein Hintergrund, kein Rahmen — nur ein Drop-Shadow auf das SVG/PNG.
  // `drop-shadow` (statt `shadow`) folgt der Alpha-Maske, sodass die
  // abgerundeten transparenten Ecken nicht im Rechteck-Schatten landen.
  const baseCls = [
    "select-none w-auto",
    SIZE_CLASSES[size],
    "transition-transform duration-150 ease-out",
    "drop-shadow-md",
    raised ? "-translate-y-2 drop-shadow-xl" : "",
    disabled ? "opacity-40 grayscale cursor-not-allowed" : "",
    interactive
      ? "cursor-pointer hover:-translate-y-2 hover:drop-shadow-xl focus:outline-none focus-visible:drop-shadow-[0_0_0_3px_rgba(245,158,11,0.7)]"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (interactive) {
    return (
      <button
        type="button"
        aria-label={label}
        className={`${baseCls} bg-transparent border-0 p-0`}
        onClick={() => onClick!(card)}
      >
        <img src={imgSrc} alt="" className="h-full w-auto" draggable={false} />
      </button>
    );
  }

  return (
    <div role="img" aria-label={label} className={baseCls}>
      <img src={imgSrc} alt="" className="h-full w-auto" draggable={false} />
    </div>
  );
}
