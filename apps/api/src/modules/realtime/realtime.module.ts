import { Global, Module } from "@nestjs/common";

import { UserSocketsService } from "./user-sockets.service.js";

/**
 * Global, damit Dienste außerhalb des Game-Moduls (z.B. Auth beim
 * Passwort-Reset) offene Sockets eines Users trennen können, ohne das
 * Gateway zu importieren.
 */
@Global()
@Module({
  providers: [UserSocketsService],
  exports: [UserSocketsService],
})
export class RealtimeModule {}
