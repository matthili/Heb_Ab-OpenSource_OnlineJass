# Werdegang — von der Idee zur spielbaren Plattform

Dieses Dokument erzählt den **Entwicklungs-Verlauf** von „Heb ab!": woher das
Projekt kommt, welche Meilensteine es durchlaufen hat, und — besonders
interessant — **wo und warum die Umsetzung bewusst vom ursprünglichen Plan
abgewichen ist**. Es ist als Lese-Stück gedacht, nicht als Referenz; die
technische Referenz steht in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Die Ausgangsidee

Geplant war von Anfang an eine **selbst-hostbare Multiplayer-Plattform für
Vorarlberger Kreuz-Jass** — echte Menschen spielen gegen- und miteinander,
freie Plätze werden mit KI-Gegnern aufgefüllt. Die Architektur sollte vom
Heim-Server („ein Container auf dem NAS für ~10 Spieler") bis zum
Container-Cluster („200+ gleichzeitige Spieler") skalieren.

Der Funktionsumfang stand früh fest: vollständiges, DSGVO-konformes
User-Management mit pro-Feld-Sichtbarkeit, Lobby mit drei Beitritts-Modi,
server-autoritativer Spiel-Loop über WebSockets, KI-Mitspieler, ein
Chat-System (Lobby/Spiel/Privatnachricht), ein Admin-Panel, Replays und
Statistiken — und Sicherheit ab Tag 1, nicht „später".

## Der Dreh- und Angelpunkt: das Schwester-Projekt

Das Besondere an der Architektur ist die strikte Trennung zur **Spiel-Logik**.
Diese kommt nicht aus dieser Web-App, sondern aus einem unabhängigen
Python-Projekt
([JCN9000](https://github.com/matthili/jcn9000)),
das drei versionierte Artefakte liefert:

1. eine **Regel-Spezifikation** (`jass_rules.json`) — die einzige Wahrheit über
   Karten, Punkte, Stich-Reihenfolge, Trumpf-Regeln, Weisen, Matsch;
2. eine **State-Encoding-Spezifikation** — wie ein Spielzustand zu einem
   Feature-Vektor für das neuronale Netz wird;
3. das **trainierte Modell** selbst, plus Test-Fixtures.

Die Web-App **importiert** diese Artefakte als versionierte Releases und
**dupliziert die Spielregeln niemals im Code**. Der TS-Port der Engine
(`packages/engine`) wird gegen die Python-Fixtures verifiziert — so kann das
Modell-Training und die Anwendung nie auseinanderdriften. Details dazu in
[`NN-CONTRACT.md`](./NN-CONTRACT.md).

## Die Reise in Meilensteinen

Die Roadmap war auf „so früh wie möglich spielbar" optimiert:

| Phase       | Inhalt                                                                      |
| ----------- | --------------------------------------------------------------------------- |
| **M0–M1**   | Monorepo, CI, Karten-Assets; NN-Artefakt-Pipeline (versionierter Download)  |
| **M2**      | TS-Port der Engine + State-Encoder, verifiziert gegen die Python-Fixtures   |
| **M3**      | API-Skelett mit Auth (Registrierung → Verifikation → Login), Postgres, Mail |
| **M4–M5**   | WebSocket-Gateway + server-autoritativer Spiel-Loop; KI-Inferenz angebunden |
| **M6–M7**   | Lobby + Tisch-Modi + KI-Auffüllung; Frontend-Hauptansichten + Landing-Page  |
| **M8–M9**   | Chat (drei Kanäle, sanitisiert); Admin-Panel (SMTP, Blocklist, Audit-Log)   |
| **M10–M11** | Replays, Profil-History, DSGVO-Export; PWA-Politur, i18n, a11y, Helm-Chart  |
| **M12**     | **Solo-Jass** — eine komplette zweite Spielvariante                         |
| **M13**     | **Bodensee-Jass** (2 Spieler) — die dritte Variante, end-to-end             |

Danach folgten mehrere Härtungs- und Politur-Durchgänge sowie eine ganze
Reihe Features, die über den Ursprungsplan hinausgingen (siehe unten).

## Bewusste Abweichungen vom Ursprungsplan

Das Projekt versteht sich nicht nur als Jass-App, sondern auch als
**Demonstration aktueller Technik**. Entsprechend wurde an mehreren Stellen
bewusst vom ursprünglich geplanten Stack abgewichen — immer in Richtung
neuerer/schlankerer Lösungen. Das ist der vielleicht lehrreichste Teil der
Geschichte:

| Bereich            | Ursprünglich geplant                  | Tatsächlich umgesetzt                                          | Warum                                                                              |
| ------------------ | ------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Auth**           | Lucia v3                              | **Better Auth 1.6**                                            | Lucia wurde eingestellt; Better Auth ist aktiv gepflegt, bringt Verify/Reset mit   |
| **ORM**            | Prisma 5                              | **Prisma 7** (mit `@prisma/adapter-pg`)                        | Aktuelle Major-Version, modernes Treiber-Adapter-Modell                            |
| **Validation**     | Zod 3 + `nestjs-zod`                  | **Zod 4** (nativ, ohne Zwischenschicht)                        | Zod 4 bringt u. a. `z.toJSONSchema()` von Haus aus mit                             |
| **UI-Primitives**  | Radix UI + Tailwind                   | **Tailwind 4** (ohne Radix)                                    | Weniger Abhängigkeiten; Tailwind 4 deckt den Bedarf ab                             |
| **Build/Frontend** | Vite 5                                | **Vite 8**, React 19                                           | Jeweils aktuelle Majors                                                            |
| **Landing**        | Astro 4                               | **Astro 6**                                                    | dito                                                                               |
| **KI-Inferenz**    | `@tensorflow/tfjs-node` + Worker-Pool | **`@tensorflow/tfjs`** (pure-JS, kein Pool)                    | Kein nativer Build nötig → einfacheres Deployment; reicht für die Last             |
| **State-Encoder**  | ein 132-dim Encoder                   | **variantenspezifisch** (Kreuz/Solo 421-dim, Bodensee 291-dim) | Jede Spielart hat ihren eigenen Encoder + ihr eigenes Modell                       |
| **Contract-Tests** | Pact                                  | **verworfen**                                                  | Playwright-E2E + Integration-Tests + die OpenAPI-aus-Zod-Generierung decken das ab |
| **OpenAPI**        | `openapi-typescript`-Pipeline         | **Zod als Single Source** → OpenAPI-Generator                  | DTO-Schemas leben einmal in `packages/shared-types`, FE+BE leiten daraus ab        |

Im Ursprungsplan war außerdem nur **eine** Spielvariante (Kreuz-Jass, 4 Spieler)
fest vorgesehen, der Rest „optional, später". Tatsächlich sind heute **drei**
Varianten spielbar: Kreuz-Jass (4 Spieler), Solo-Jass (4 Spieler) und
Bodensee-Jass (2 Spieler).

## Was über den Plan hinaus entstand

Eine Reihe von Funktionen kam erst im Lauf der Entwicklung dazu — teils als
Robustheits-Verbesserung, teils weil die Ursprungsspezifikation sie nur grob
erwähnte:

- **Solo-Jass & Bodensee-Jass** als vollwertige Varianten (eigene Engine-Logik,
  eigenes NN-Modell, eigenes Scoreboard).
- **Drei KI-Stufen** statt „NN oder nichts": Zufall (zum Üben), eine regelbasierte
  **Heuristik** als Standard-Gegner (TS-Port aus JCN9000, inkl. Trumpf-Disziplin
  über Void-Inferenz) und das **neuronale Netz** als stärkste Stufe — mit einem
  eigenen, separat trainierten Modell je Spielart.
- **Disconnect-Handling** statt stillem Spielabbruch: bei Verbindungsverlust eine
  mehrstufige Abstimmung (Kreuz/Solo) bzw. eine Reconnect-Schonfrist mit
  KI-Übernahme (Bodensee).
- **Re-Match-Flow** nach Spielende.
- **Erst-Admin-Bootstrap** — eine frische Installation kann ihren ersten Admin
  per Umgebungsvariable oder CLI einrichten, ohne Datenbank-Gefummel.
- **HaveIBeenPwned-Passwort-Check** zusätzlich zur Entropie-Prüfung.
- **Öffentlich teilbare Replays** (Opt-in pro Partie, eigener Share-Link).
- **Globales Leaderboard** (Opt-in pro Nutzer) und Basis-Statistiken pro Variante.
- **Web-Push**-Benachrichtigungen für Beitritts-Anfragen.
- **Lobby-Präsenz** („wer ist gerade online?") und eine
  **Profil-Konversations-History**, die Privatnachrichten dem Spiel-Kontext
  zuordnet.
- **Chat-Wortfilter** und **globale Lobby-Einstellungen** im Admin-Bereich.

## Leitprinzipien, die durchgehalten haben

Vier Grundsätze sind über die gesamte Entwicklung stabil geblieben:

1. **Single Source of Truth für die Spielregeln** — sie kommen aus dem
   Schwester-Projekt und werden nie im App-Code dupliziert.
2. **Server-autoritativer Spielzustand** — Clients sehen nur ihre eigene Hand;
   schummeln ist clientseitig nicht möglich.
3. **Sicherheit ab Tag 1** — Argon2id, CSRF-Schutz, Rate-Limiting, CSP,
   Markdown-Sanitization, Audit-Log waren nie „kommt später".
4. **Moderner Stack als Ziel, nicht als Zufall** — bei Versions- oder
   Framework-Entscheidungen wird bewusst die aktuelle, gepflegte Variante
   gewählt.
