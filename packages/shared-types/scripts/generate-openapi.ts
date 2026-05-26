#!/usr/bin/env tsx
/**
 * OpenAPI-Doc aus den geteilten Zod-Schemas.
 *
 * Lauf (Repo-Root):
 *   pnpm --filter @jass/shared-types gen:openapi
 *
 * Output: `packages/shared-types/openapi.json`. Wird im Repo committet,
 * damit Doku-Tools / Mobile-Clients das Schema lesen können, ohne den
 * TypeScript-Build laufen zu lassen.
 *
 * **Tech-Wahl**: Zod 4 bringt `z.toJSONSchema()` als First-Party-Feature
 * mit. Wir wandeln jedes Schema einzeln zu JSON-Schema und kleben daraus
 * ein OpenAPI-3.1-Dokument zusammen. Vorteile gegenüber einem externen
 * Konverter (z.B. `@asteasolutions/zod-to-openapi`): null zusätzliche
 * Abhängigkeit, keine Lücken bei neuen Zod-4-Typen (`ZodDefault`,
 * `ZodReadonly`, …), und der Output bleibt minimal und kontrolliert.
 *
 * **Stand der Migration**: nur die in `@jass/shared-types` migrierten
 * Lobby-Schemas sind hier abgebildet. Weitere Endpunkte kommen mit, wenn
 * sie auf die Shared-Schemas wechseln (PLAN.md §14).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  InviteUserDtoSchema,
  ListTablesQuerySchema,
  OpenTableDtoSchema,
  RematchVoteDtoSchema,
  TableDetailViewSchema,
  TableListEntrySchema,
  UpdateTableSettingsDtoSchema,
} from "../src/contracts/lobby.js";

/**
 * Schemas mit ihrem späteren OpenAPI-Namen — Reihenfolge spielt keine Rolle,
 * Namen müssen eindeutig sein (Component-Schlüssel im OpenAPI-Doc).
 */
const SCHEMAS = {
  OpenTableDto: OpenTableDtoSchema,
  UpdateTableSettingsDto: UpdateTableSettingsDtoSchema,
  InviteUserDto: InviteUserDtoSchema,
  RematchVoteDto: RematchVoteDtoSchema,
  ListTablesQuery: ListTablesQuerySchema,
  TableListEntry: TableListEntrySchema,
  TableDetailView: TableDetailViewSchema,
} as const;

function ref(name: keyof typeof SCHEMAS): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` };
}

const components: Record<string, unknown> = {};
for (const [name, schema] of Object.entries(SCHEMAS)) {
  // Zod 4's toJSONSchema liefert JSON-Schema 2020-12; OpenAPI 3.1 ist
  // dazu kompatibel (das war der Grund für 3.1 vs. 3.0).
  //
  // - `io: "input"` beschreibt den PRE-Transform-Shape (was der Client
  //   schickt). Antworten/Views könnten man eigentlich mit "output"
  //   beschreiben — für die View-Schemas reicht "input" aber, weil sie
  //   keine Transforms haben.
  // - `unrepresentable: "any"` lässt Zod-Konstrukte ohne JSON-Schema-
  //   Äquivalent (z.B. komplexe Transforms) als `{}` (= `any`) durch,
  //   statt zu werfen — JSON Schema kann sie nicht ausdrücken, aber das
  //   Dokument soll trotzdem geschrieben werden.
  components[name] = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

const document = {
  openapi: "3.1.0",
  info: {
    title: "Heb ab! — Vorarlberger Kreuz-Jass API",
    version: "0.1.0",
    description:
      "Auto-generated aus den geteilten Zod-Schemas in @jass/shared-types. " +
      "Stand der Migration in PLAN.md §14 — noch nicht jeder Endpunkt ist hier dokumentiert.",
  },
  servers: [{ url: "http://localhost:3000", description: "Lokal" }],
  paths: {
    "/api/lobby/tables": {
      post: {
        summary: "Tisch öffnen",
        tags: ["Lobby"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("OpenTableDto") } },
        },
        responses: {
          "201": {
            description: "Tisch angelegt",
            content: {
              "application/json": {
                schema: { type: "object", properties: { tableId: { type: "string" } } },
              },
            },
          },
        },
      },
      get: {
        summary: "Tisch-Liste",
        tags: ["Lobby"],
        parameters: [
          { name: "status", in: "query", required: false, schema: { type: "string" } },
          { name: "joinMode", in: "query", required: false, schema: { type: "string" } },
          { name: "mine", in: "query", required: false, schema: { type: "boolean" } },
        ],
        responses: {
          "200": {
            description: "Liste passender Tische",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { tables: { type: "array", items: ref("TableListEntry") } },
                },
              },
            },
          },
        },
      },
    },
    "/api/lobby/tables/{id}": {
      get: {
        summary: "Tisch-Detail",
        tags: ["Lobby"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Detailansicht",
            content: { "application/json": { schema: ref("TableDetailView") } },
          },
        },
      },
      patch: {
        summary: "Tisch-Settings ändern (Owner-only)",
        tags: ["Lobby"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("UpdateTableSettingsDto") } },
        },
        responses: { "204": { description: "Updated" } },
      },
    },
    "/api/lobby/tables/{id}/invite": {
      post: {
        summary: "Spieler an den Tisch einladen",
        tags: ["Lobby"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("InviteUserDto") } },
        },
        responses: { "201": { description: "Einladung erstellt" } },
      },
    },
    "/api/games/{id}/rematch-vote": {
      post: {
        summary: "Re-Match-Vote nach Spielende",
        tags: ["Lobby"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("RematchVoteDto") } },
        },
        responses: {
          "201": {
            description: "Vote registriert (kind beschreibt das Ergebnis)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    kind: {
                      type: "string",
                      enum: ["pending", "rematch-started", "rematch-rejected"],
                    },
                    gameId: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: { schemas: components },
};

const outPath = resolve(fileURLToPath(import.meta.url), "..", "..", "openapi.json");
writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n", "utf8");
console.info(
  `OpenAPI-Doc geschrieben: ${outPath} ` +
    `(${Object.keys(document.paths).length} Pfade, ` +
    `${Object.keys(components).length} Komponenten).`
);
