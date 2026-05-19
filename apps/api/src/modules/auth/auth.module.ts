import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { TurnstileService } from "./turnstile.service.js";

@Module({
  providers: [AuthService, TurnstileService],
  controllers: [AuthController],
  exports: [AuthService, TurnstileService],
})
export class AuthModule {}
