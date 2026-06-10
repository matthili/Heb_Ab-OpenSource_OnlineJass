/**
 * Marken-Logo, das automatisch zum Theme passt.
 *
 * Es werden **beide** Varianten gerendert (hell + dunkel); welche sichtbar
 * ist, entscheidet CSS über das `data-theme`-Attribut auf `<html>`
 * (siehe `.brand-light` / `.brand-dark` in styles.css). Grund: der
 * `useTheme`-Hook hält pro Komponente eigenen State und ist NICHT reaktiv
 * über Komponentengrenzen — der reine CSS-Weg schaltet dagegen sofort um,
 * sobald der Theme-Toggle das Attribut ändert.
 *
 * - `variant`: `horizontal` (Lockup mit Schriftzug nebeneinander) oder
 *   `gestapelt` (übereinander).
 * - `decorative`: rein dekorativ (z.B. Watermark) → leeres alt + aria-hidden.
 * - `className`: Layout-Klassen (Höhe etc.) — gelten für beide `<img>`.
 */
interface BrandLogoProps {
  variant: "horizontal" | "gestapelt";
  className?: string;
  alt?: string;
  decorative?: boolean;
}

export function BrandLogo({ variant, className = "", alt, decorative = false }: BrandLogoProps) {
  const base = `/logo/lockup-${variant}`;
  const imgProps = decorative
    ? { alt: "", "aria-hidden": true as const }
    : { alt: alt ?? "Heb ab!" };
  return (
    <>
      <img src={`${base}-hell.svg`} className={`brand-light ${className}`} {...imgProps} />
      <img src={`${base}-dunkel.svg`} className={`brand-dark ${className}`} {...imgProps} />
    </>
  );
}
