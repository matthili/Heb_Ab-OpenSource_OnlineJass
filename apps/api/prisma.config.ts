/**
 * Prisma 7 Konfiguration.
 *
 * Hintergrund: Ab Prisma 7 wandert die Datenbank-URL aus dem `datasource`-Block
 * der `schema.prisma` in diese Config. Vorteile: die Schema-Datei wird damit
 * deklarativ-statisch (kein env()-Indirection mehr), und Migrate hat eine klar
 * getrennte Konfig-Quelle.
 *
 * Wir laden `.env` aus dem API-Workspace, weil `prisma migrate dev` aus genau
 * diesem Verzeichnis aufgerufen wird (CWD = apps/api). Auf der gleichen Höhe
 * liegt auch die `.env` mit `DATABASE_URL=postgres://…`.
 *
 * Die URL selber bleibt damit weiterhin in `.env` — kein Hardcoding hier.
 */
import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL ist nicht gesetzt. Lege sie in apps/api/.env an (siehe .env.example)."
  );
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  // Ab Prisma 7 muss die Connection-URL explizit hier stehen, nicht mehr im
  // datasource-Block der schema.prisma. Wir reichen sie 1:1 aus dem env weiter.
  datasource: {
    url: databaseUrl,
  },
});
