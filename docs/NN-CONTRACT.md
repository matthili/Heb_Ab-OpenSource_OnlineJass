# NN-Schnittstelle zum Schwester-Projekt

Die Web-App importiert drei Arten von Artefakten aus [`jass-neuronales-netz`](../../jass_neuronales_netz/):

| Artefakt              | Pfad nach Sync                              | Zweck                                                                   |
| --------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| **Regel-Spec**        | `external/jass-nn/jass_rules.json`          | Quelle für `packages/engine/src/types.ts` (Type-Gen) + alle Spielregeln |
| **Encoding-Spec**     | `external/jass-nn/state_encoding.md`        | Referenz-Doku für `packages/engine/src/encoder.ts`                      |
| **Encoding-Fixtures** | `external/jass-nn/encoding_fixtures.json`   | Verifikations-Tests für TS-Encoder (byte-equivalent)                    |
| **TF.js-Modell**      | `external/jass-nn/tfjs/{model.json, *.bin}` | Geladen vom `apps/inference`-Service                                    |
| **MANIFEST**          | `external/jass-nn/MANIFEST.json`            | Version, Hashes, encoding_version, spec_version                         |

## Versionierung

Im Web-Repo wird die NN-Version in `package.json#jassNn.version` gepinnt:

```json
"jassNn": {
  "version": "v0.5.0",
  "repo": "matthili/jass-neuronales-netz",
  "encodingVersion": "3.0.0",
  "specVersion": "1.1.0"
}
```

## Sync-Workflow

```powershell
# 1. NN-Repo veröffentlicht Release-ZIP `jass-nn-vX.Y.Z.zip` mit:
#    tfjs/, jass_rules.json, state_encoding.md, encoding_fixtures.json, MANIFEST.json

# 2. Web-Repo: lokal oder in CI
pnpm sync:nn       # gh release download + unzip → external/jass-nn/  (M1)
pnpm verify:nn     # Manifest- + Hash- + Versions-Verifikation

# 3. Engine-Type-Generierung (M2):
pnpm --filter @jass/engine build
```

## Konsistenz-Garantien

- **Drift wird verhindert** durch:
  - Type-Gen aus `jass_rules.json` (jede Spec-Änderung erzeugt neue TS-Types → Compile-Fail wenn Code nicht aktualisiert wird)
  - Fixture-Tests gegen `encoding_fixtures.json` (jede Encoder-Änderung schlägt fehl, wenn Vektoren nicht mehr byte-equivalent)
  - Nightly Self-Play-Parity-Test mit Python-Trace (Move-für-Move-Vergleich)

- **MANIFEST.encoding_version** muss exakt der `EXPECTED_ENCODING_VERSION` in `packages/engine` entsprechen, sonst Hard-Error beim Modell-Boot.

## Modell-Updates

Ein neues NN-Modell wird so eingespielt:

1. NN-Repo veröffentlicht `v1.1.0`.
2. Web-Repo PR: `package.json#jassNn.version` auf `v1.1.0` setzen.
3. `pnpm sync:nn && pnpm verify:nn && pnpm test`.
4. Bei Tests-grün: Merge. Container-Build greift in den neuen Pin.

**Achtung Major-Version:** Bei `encoding_version`-Bump (Breaking Change im Encoder) müssen TS-Port (`encoder.ts`) und Fixture-Tests parallel angepasst werden. Der Spec-Schema-Test in `packages/engine` schlägt sonst sofort fehl.

## Status der Pipeline

Aktuell gepinnt: **v0.5.0** (`package.json#jassNn.version`).

| Komponente                                   | Status                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| Python-Engine + Tests im NN-Repo             | ✅ vorhanden                                                                 |
| `jass_rules.json` (spec_version 1.1.0)       | ✅ in v0.5.0 — additive Änderung: neue Variante **Gumpf**                    |
| `state_encoding.md` (encoding_version 3.0.0) | ✅ in v0.5.0 — **Breaking Change**: 132 → 421 dims, per-Sitz-History         |
| `encoding_fixtures.json`                     | ✅ 15 Fixtures (inkl. 3 Gumpf-Cases), TS-Encoder verifiziert byte-equivalent |
| `keras/best.keras`                           | ✅ in Release v0.5.0 (Multi-Head policy+value, 15 MB)                        |
| Release-ZIP + MANIFEST                       | ✅ Release v0.5.0 öffentlich verfügbar                                       |
| `pnpm sync:nn` (Download + SHA-Verify)       | ✅ produktiv                                                                 |
| `tfjs/` (TF.js-Modell für Web-Inferenz)      | ⏳ in v0.5.0 weiterhin **nicht im ZIP**, trotz Release-Body-Versprechen      |

### Encoder-Version-History

| Version   | Featurevektor | Wesentliche Änderung                                                                                                                |
| --------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0     | 132 dims      | Initiales Layout, History nicht spielerspezifisch                                                                                   |
| 2.0.0     | 348 dims      | Spielerspezifische History (per Sitz aufgeschlüsselt) — übersprungen im Web-Repo                                                    |
| **3.0.0** | **421 dims**  | + `value_per_card` (36) + `strength_per_card` (36) vorberechnet; `mode` 4 → 5 Bits (`is_gumpf`); `trump_suit`-Onehot auch bei GUMPF |

**Status `tfjs/`:** Die Release-Bodies versprechen seit v0.1.0 ein `tfjs/`-Verzeichnis; das tatsächliche ZIP enthält es bisher nicht. Solange das so bleibt, kann `apps/inference` (M5) nicht hochfahren. **M2, M3, M4 sind davon unberührt** — TS-Engine, Auth + Game-Loop arbeiten ausschließlich gegen Spec + Fixtures. Für M4 kann der KI-Sitz übergangsweise einen `RandomLegalMovePlayer` nutzen.

### Spielvarianten (Spec 1.1.0)

| ID          | Trumpf? | Stich-Reihenfolge                  | Wertpunkte              | Buur-Ausnahme | Note                                                  |
| ----------- | ------- | ---------------------------------- | ----------------------- | ------------- | ----------------------------------------------------- |
| `trumpf`    | ja      | normal in Lead                     | Buur=20, Nell=14        | aktiv         | Klassisch                                             |
| **`gumpf`** | **ja**  | **invertiert in Lead (non-trump)** | **wie Trumpf**          | **aktiv**     | **Hybrid: Trumpf-Farbe trumpf-like, Rest geiss-like** |
| `oben`      | nein    | normal                             | 8er=8                   | —             | Bock                                                  |
| `unten`     | nein    | invertiert                         | 8er=8                   | —             | Geiss                                                 |
| `slalom`    | nein    | wechselt OBEN ↔ UNTEN              | je nach aktuellem Modus | —             | Slalom darf NICHT mit Gumpf kombiniert werden         |
