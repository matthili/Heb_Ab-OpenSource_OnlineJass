import { Module } from "@nestjs/common";

import { ConfigController } from "./config.controller.js";

/**
 * Öffentliche Laufzeit-Konfiguration (siehe ConfigController). Eigenes Modul,
 * damit der Endpoint ohne Auth-Guards bleibt (nur der globale OriginCheck).
 */
@Module({
  controllers: [ConfigController],
})
export class PublicConfigModule {}
