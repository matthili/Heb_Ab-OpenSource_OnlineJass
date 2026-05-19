/**
 * `@Global()`-Modul für den `AppSecretService`.
 *
 * Globalität gerechtfertigt, weil:
 *   - Querschnitts-Service: jeder Modul kann krypto-sensible Sub-Keys brauchen.
 *   - Stateful Singleton (Master-Secret + Cache abgeleiteter Sub-Keys).
 *   - DI-Importierungs-Boilerplate in 5+ Modulen würde nur Lärm produzieren.
 *
 * Lifecycle: `onModuleInit` läuft genau einmal beim Boot — Validation
 * passiert dort und kann den App-Start abbrechen. Tests setzen
 * `APP_SECRET` selbst (siehe test/integration/setup.ts).
 */
import { Global, Module } from "@nestjs/common";

import { AppSecretService } from "./app-secret.service.js";

@Global()
@Module({
  providers: [AppSecretService],
  exports: [AppSecretService],
})
export class AppSecretModule {}
