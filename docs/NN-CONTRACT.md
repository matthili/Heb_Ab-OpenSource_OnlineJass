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
  "version": "v0.1.0",
  "repo": "matthili/jass-neuronales-netz",
  "encodingVersion": "1.0.0",
  "specVersion": "1.0.0"
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

| Komponente                                   | Status                                                       |
| -------------------------------------------- | ------------------------------------------------------------ |
| Python-Engine + Tests im NN-Repo             | ✅ vorhanden                                                 |
| `jass_rules.json` (spec_version 1.0.0)       | ✅ in Release v0.1.0                                         |
| `state_encoding.md` (encoding_version 1.0.0) | ✅ in Release v0.1.0                                         |
| `encoding_fixtures.json`                     | ✅ in Release v0.1.0                                         |
| `keras/best.keras`                           | ✅ in Release v0.1.0 (1.7 MB)                                |
| Release-ZIP + MANIFEST                       | ✅ Release v0.1.0 öffentlich verfügbar                       |
| `pnpm sync:nn` (Download + SHA-Verify)       | ✅ produktiv                                                 |
| `tfjs/` (TF.js-Modell)                       | ⏳ erst in **v0.2.0** (Multi-Head-Modell, kommt diese Woche) |

Solange `tfjs/` fehlt, kann `apps/inference` noch nicht gestartet werden — das blockiert aber nur **M5+**. M2 (TS-Port der Engine), M3 (API + Auth) und M4 (WS-Gateway + Game-Loop mit Random-KI) sind davon nicht betroffen.
