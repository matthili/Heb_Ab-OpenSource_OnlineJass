/**
 * Spielkarten-Komponente.
 *
 * **Asset-Quelle**: PNGs aus `assets/cards/`, vom Web-App per Build-Step
 * nach `public/cards/` kopiert. Dateiname-Schema: `{suit}-{rank}.png`,
 * Welli als Sonderfall `schelle-6-weli.png`.
 *
 * **A11y**: Jede Karte hat ein `aria-label` mit der lesbaren Bezeichnung
 * (z.B. „Herz Bauer"). `role="button"` nur, wenn die Karte interaktiv ist
 * (`onClick` gesetzt); reine Render-Karten sind `role="img"`.
 *
 * **Disabled/Illegal**: Wenn `disabled` (z.B. weil nicht in der
 * `legalActionMask`), wird die Karte 50 % transparent und kein Click-
 * Handler triggert. Tab-Fokus überspringt sie via `tabIndex={-1}`.
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
  size?: "sm" | "md" | "lg";
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

const SIZE_CLASSES = {
  sm: "w-12 h-18",
  md: "w-20 h-30",
  lg: "w-28 h-42",
} as const;

export function Card(props: CardProps) {
  const { card, onClick, disabled = false, raised = false, size = "md", className = "" } = props;
  const interactive = Boolean(onClick) && !disabled;

  // Dateiname: Sonderfall Welli (Schelle-6) bekommt `schelle-6-weli.png`,
  // alle anderen folgen dem `{suit}-{rank}.png`-Schema.
  const isWeli = card.suit === "SCHELLE" && card.rank === "SECHS";
  const imgSrc = isWeli
    ? "/cards/schelle-6-weli.png"
    : `/cards/${SUIT_FILE[card.suit]}-${RANK_FILE[card.rank]}.png`;

  const label = `${SUIT_LABEL[card.suit]} ${RANK_LABEL[card.rank]}${isWeli ? " (Welli)" : ""}`;

  const baseCls = [
    "select-none rounded-md shadow-sm border border-stone-300 bg-white",
    "transition-transform duration-150 ease-out",
    SIZE_CLASSES[size],
    raised ? "-translate-y-2 shadow-md" : "",
    disabled ? "opacity-50 cursor-not-allowed" : "",
    interactive
      ? "cursor-pointer hover:-translate-y-1 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (interactive) {
    return (
      <button type="button" aria-label={label} className={baseCls} onClick={() => onClick!(card)}>
        <img src={imgSrc} alt="" className="w-full h-full object-contain" draggable={false} />
      </button>
    );
  }

  return (
    <div role="img" aria-label={label} className={baseCls} tabIndex={disabled ? -1 : undefined}>
      <img src={imgSrc} alt="" className="w-full h-full object-contain" draggable={false} />
    </div>
  );
}
