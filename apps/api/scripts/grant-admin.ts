#!/usr/bin/env tsx
/**
 * CLI: einen bestehenden User zum Admin befördern.
 *
 * Lauf (aus dem Repo-Root):
 *   pnpm --filter @jass/api admin:grant <email>
 *
 * Zweck: den allerersten Admin einer frischen Installation einrichten — ohne
 * rohes SQL — oder später weitere Admins anlegen / einen ausgesperrten Betrieb
 * retten. Ergänzt den `ADMIN_EMAIL`-Mechanismus (siehe AdminBootstrapService):
 * dieselbe idempotente Beförderungs-Logik, nur manuell und ohne API-Neustart.
 *
 * Der User muss bereits registriert sein — Accounts legt nur der normale
 * Sign-up-Flow an.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  ADMIN_BOOTSTRAP_ACTION,
  promoteUserToAdmin,
} from "../src/modules/admin/admin-bootstrap.util.js";

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email || email.startsWith("-")) {
    console.error("Usage: pnpm --filter @jass/api admin:grant <email>");
    process.exit(1);
  }

  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL ist nicht gesetzt — siehe apps/api/.env (.env.example).");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const result = await promoteUserToAdmin(prisma, email);
    switch (result.kind) {
      case "user-not-found":
        console.error(
          `✖ Kein User mit E-Mail "${result.email}" gefunden. ` +
            `Erst über die App registrieren, dann erneut ausführen.`
        );
        process.exit(1);
        return;
      case "already-admin":
        console.info(`• "${result.email}" (${result.userId}) ist bereits Admin — nichts zu tun.`);
        return;
      case "promoted":
        // Audit-Eintrag direkt schreiben — das CLI hat keinen AuditService.
        await prisma.auditLog.create({
          data: {
            action: ADMIN_BOOTSTRAP_ACTION,
            actorId: null,
            target: result.userId,
            meta: {
              email: result.email,
              via: "cli",
              source: "cli",
              previousRole: result.previousRole,
            },
          },
        });
        console.info(
          `✔ "${result.email}" (${result.userId}) ist jetzt Admin ` +
            `(vorher: ${result.previousRole}).`
        );
        return;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("grant-admin fehlgeschlagen:", err);
  process.exit(1);
});
