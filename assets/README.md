# Assets

Statische Spielassets — Karten, Symbole, Logos und Diagramme. Web-App und Landing-Site bekommen die Karten über eine Kopie (siehe unten).

## `cards/`

Karten-PNGs für das Vorarlberger Deck. Sie liegen im Repo. Ursprünglich übernommen per `pnpm import:cards` aus einem Ordner `jasskarten-assets/` im Repo-Root — der gehört nicht zum Repo; den Import braucht es nur, um die Bilder aus diesem Original-Ordner neu zu übernehmen.

Web-App und Landing-Site lesen die Karten nicht direkt von hier: `scripts/sync-web-cards.mjs` und `scripts/sync-landing-cards.mjs` kopieren sie vor jedem `dev`/`build` automatisch nach `apps/web/public/cards/` bzw. `apps/landing/public/cards/` (idempotent).

### Konvention

- Datei-Schema: `{suit}-{rank}.png`
- Suits: `eichel`, `schelle`, `herz`, `laub`
- Ranks: `6`, `7`, `8`, `9`, `10`, `U` (Unter), `O` (Ober), `K` (König), `A` (Ass)
- Sonderfall: `schelle-6-weli.png` für den WELI (zählt im Spielverlauf wie eine normale Schelle-6)

### `cards/suits/`

Symbole für UI-Markierungen (Stich-Indikator, Trumpf- und Ansage-Anzeige):

- Farb-Symbole: `eichel.png`, `schelle.png`, `herz.png`, `laub.png` — migriert aus `jasskarten-assets/farbsymbole/`
- Ansage-Symbole: `{suit}_gumpf.png` (Gumpf in der jeweiligen Farbe), `bock.png` (Oben), `geiss.png` (Unten), `slalom.png`

### `cards/overview/`

Übersichts-PNGs (Fächer-Ansicht aller Karten einer Farbe, `alle-karten.png`) für Tutorial/Hilfe-Seiten. Migriert aus `jasskarten-assets/faecher/`.

## `diagrams/`

PlantUML-Quellen (`*.puml`) und die daraus gerenderten PNGs, eingebunden in README und `docs/`. Die Diagramme bringen ihren eigenen hellen Hintergrund mit, damit sie auf GitHub im hellen wie im dunklen Modus lesbar sind. Neu rendern (aus dem Repo-Root, mit lokalem `plantuml.jar`):

```bash
java -DPLANTUML_LIMIT_SIZE=16384 -jar <pfad>/plantuml.jar assets/diagrams/<name>.puml
```

## `logo/`

Logo-Lockups von „Heb ab!" (gestapelt/horizontal, je hell/dunkel), die Bildmarke (`marke.*`) und die Logos des Schwester-Projekts JCN9000.
