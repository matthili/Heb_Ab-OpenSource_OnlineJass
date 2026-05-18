# E2E-Tests (M7-G)

End-to-End-Tests gegen den **laufenden** Stack via Playwright (Chromium).

## Voraussetzungen

Drei Terminals offen, jeweils im Repo-Root:

```bash
# 1) Infra-Stack (Postgres, Redis, Mailhog)
pnpm dev:stack

# 2) API
pnpm --filter @jass/api dev

# 3) Web-SPA
pnpm --filter @jass/web dev
```

Außerdem einmalig die Playwright-Browser installieren:

```bash
pnpm --filter @jass/web exec playwright install chromium
```

## Tests ausführen

```bash
# Alle E2E-Tests, headless
pnpm --filter @jass/web test:e2e

# Interaktive UI mit Trace-Viewer
pnpm --filter @jass/web test:e2e:ui
```

## Was getestet wird

### `a11y.spec.ts` (M11-C) — WCAG 2.1 AA-Audit via axe-core

Läuft `@axe-core/playwright` gegen die Hauptrouten (anonym + eingeloggt) und
verlangt **0 Critical-Violations**. Serious wird nicht hart gegated (Radix-
Primitives lösen gelegentlich Heuristik-Fehlalarme aus).

### `solo-vs-ai.spec.ts` — das Plan-Doc-§11-Szenario komprimiert auf einen Browser:

1. Register → Verify-Mail aus Mailhog → Verify-Link klicken
2. Login → Lobby
3. Tisch öffnen mit „Solo gegen 3 KI"-Shortcut → Auto-Start
4. Spielfläche erscheint, Hand mit 9 Karten
5. Loop: bei jedem „Du bist dran" die erste legale Karte klicken (KIs ziehen automatisch nach)
6. Nach 9 Stichen: Spiel-Ende, Final-Score sichtbar, Re-Match-UI mit YES/NO

Der ursprüngliche §11-Test mit **zwei Browser-Contexts** (A öffnet, B joint via Lobby,
dann Auto-Fill) deckt dieselbe WS-Subscribe-Mechanik ab — der Solo-Test ist als kürzer
gleich aussagekräftig. Multi-Browser kann später separat ergänzt werden.

## Mailhog-Pickup

`helpers/mailhog.ts` polled die Mailhog-REST-API (`localhost:8025/api/v2/messages`)
nach Mails an die Test-Adresse und extrahiert den Verify-Link mittels Regex.
Vor jedem Test wird die Mailhog-Inbox geleert (`purgeMailhog`).
