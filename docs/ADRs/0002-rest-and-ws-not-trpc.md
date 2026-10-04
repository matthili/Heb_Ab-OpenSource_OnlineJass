# ADR 0002: REST (OpenAPI) + WebSocket, kein tRPC

- **Status:** akzeptiert
- **Datum:** 2026-05-14

## Kontext

Das Backend muss zwei sehr verschiedene Verkehrsmuster bedienen:

1. **Request/Response** — Auth, Profil, Lobby-Listen, Admin.
2. **Event-Stream** — Spielzustand, Chat, Presence (push-getrieben).

Backend und Frontend sind beide TypeScript. tRPC wäre eine offensichtliche Option für End-to-End-Typsicherheit.

## Optionen

1. **REST (OpenAPI) + Socket.IO** — klare Trennung, OpenAPI-Client-Codegen für Mobile später.
2. **tRPC + Subscriptions** — eine Schicht, voll typsicher, aber WS-Subscriptions sind tRPC-spezifisch.
3. **Pures WS-RPC** — eine Transport-Schicht, keine REST. Verliert Browser-Caching, CDN-Tauglichkeit und tooling.

## Entscheidung

**REST + WebSocket.**

- Spiel-Loop ist genuin eventgetrieben — REST hat dort nichts zu suchen.
- OpenAPI-Spec ist sprachneutral → Mobile-Client (Flutter) bekommt späteren Code-Gen kostenlos.
- tRPC zwingt FE und BE in die gleiche TS-Version + monorepo-Pin; das ist hier ohnehin der Fall, aber wir geben dafür offene Schnittstellen auf.
- Typsicherheit halten wir via `packages/shared-types`: `openapi-typescript` für HTTP-Typen, eigene discriminated unions für WS-Events; Zod-Schemas einmal definiert, beidseitig importiert.

## Konsequenzen

- API-Modul publiziert OpenAPI 3.1 via NestJS-Swagger.
- WS-Events sind in `packages/shared-types/src/ws-events.ts` definiert als TS discriminated unions; Runtime-Validierung via Zod im Gateway.
- Wenn sich tRPC-Use-Case zeigt (z.B. einzelne hochgradig spezialisierte FE-Mutations), kann tRPC additiv eingeführt werden, ohne REST/WS zu ersetzen.

## Nachtrag (Umsetzung)

Die OpenAPI-Typen werden **aus den Zod-Schemas generiert** (`pnpm gen:openapi`) statt über eine separate `openapi-typescript`-Quelle. Die Grundentscheidung (REST + WS statt tRPC) ist unverändert. Stand 2026-10-04 weicht die Umsetzung in drei Punkten von den Konsequenzen oben ab:

- **Kein NestJS-Swagger.** Das OpenAPI-3.1-Dokument erzeugt `packages/shared-types` aus seinen Zod-Schemas (`openapi.json`, im Repo committet). Es umfasst die geteilten **Lobby-Verträge** (Tische, Einladung, Re-Match-Abstimmung), nicht die ganze API.
- **REST-DTOs:** Die Lobby-Schemas teilen sich FE und BE über `packages/shared-types`; die übrigen DTOs liegen als Zod-Schemas in `apps/api` (`*.dto.ts`) und werden dort per `ZodValidationPipe` geprüft.
- **WS-Events:** Eine `ws-events.ts` in `packages/shared-types` gibt es nicht. Die Gateways prüfen eingehende Payloads selbst (Typ und Form der Felder), dazu kommen Rate-Limit pro Socket und die Sitz-/Zug-Validierung der Engine.
