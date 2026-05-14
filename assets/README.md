# Assets

Statische Spielassets — werden in M7 vom Frontend importiert.

## `cards/`

Karten-PNGs für das Vorarlberger Deck. Migriert via `pnpm import:cards` aus `jasskarten-assets/` im Repo-Root.

### Konvention

- Datei-Schema: `{suit}-{rank}.png`
- Suits: `eichel`, `schelle`, `herz`, `laub`
- Ranks: `6`, `7`, `8`, `9`, `10`, `U` (Unter), `O` (Ober), `K` (König), `A` (Ass)
- Sonderfall: `schelle-6-weli.png` für den Weli (zählt im Spielverlauf wie eine normale Schelle-6)

### `cards/suits/`

Reine Farb-Symbole (Eichel, Schelle, Herz, Laub) für UI-Markierungen (Stich-Indikator, Trumpf-Anzeige). Migriert aus `jasskarten-assets/farbsymbole/`.

### `cards/overview/`

Übersichts-PNGs (z.B. Fächer-Ansicht aller Karten einer Farbe) für Tutorial/Hilfe-Seiten. Migriert aus `jasskarten-assets/faecher/`.
