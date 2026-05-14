import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";

@Module({
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
