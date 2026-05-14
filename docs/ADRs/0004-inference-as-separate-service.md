# ADR 0004: KI-Inferenz als eigener Microservice

- **Status:** akzeptiert
- **Datum:** 2026-05-14

## Kontext

Die KI-Gegner basieren auf einem TensorFlow.js-Modell, das mit `@tensorflow/tfjs-node` ausgeführt wird. Pro KI-Zug fragt das `apps/api` einen Vorhersage-Endpunkt: Eingabe ist der 132-dim Featurevektor + 36-bit Aktionsmaske, Ausgabe ist `argmax` über die Aktions-Wahrscheinlichkeiten.

Es gibt zwei plausible Platzierungen:

1. Innerhalb des API-Containers als Worker-Thread-Pool.
2. Eigener Service (`apps/inference/`), per HTTP angesprochen.

## Entscheidung

**Eigener Microservice `apps/inference/` mit Fastify + tfjs-node + Piscina-Worker-Pool.**

## Gründe

| Aspekt          | Worker-Thread in API                           | Eigener Microservice (gewählt)                                  |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Container-Größe | API-Image ~ 200 MB durch tfjs-node native deps | API schlank (~80 MB), Inferenz-Image isoliert (~300 MB)         |
| Skalierung      | API + KI skalieren gemeinsam                   | KI separat skalierbar (k8s HPA auf eigene Metriken)             |
| Modell-Reload   | API-Restart nötig                              | Rolling-Deploy ohne Spielabbrüche                               |
| CPU-Isolation   | Inferenz-Spike blockiert Event-Loop nicht      | Native getrennt                                                 |
| Crashes         | Native-Lib-Crash → API down                    | Crash betrifft nur Inferenz, API hat Random-Legal-Move-Fallback |
| Lokales Dev     | `nest start` reicht                            | `docker compose up` (oder zweites pnpm-Script)                  |
| Latenz          | ~ keine                                        | +1–3 ms im Pod-Netz (vernachlässigbar)                          |

## Konsequenzen

- HTTP-Contract: `POST /predict { encodingVersion, state[132], mask[36] } → { modelVersion, logits[36], argmax }`. JSON statt gRPC bewusst — debug-bar, Inferenz selbst dominiert Latenz.
- Modell wird beim Start geladen; encoding_version aus MANIFEST.json gegen Konstante in `packages/engine` geprüft → Fail-Fast bei Mismatch.
- `apps/inference` importiert `packages/engine/src/encoder.ts` (gleiche Quelle wie API) — so kann der Service auch direkt aus rohen GameStates encoden, falls das später nötig wird.
- Fallback bei 5xx: Game-Service in API ruft `engine.legalMoves()`, wählt zufällig + Sentry-Event. Spiel läuft weiter mit „dummer" KI, keine Spielabbrüche.
