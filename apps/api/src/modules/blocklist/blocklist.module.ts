import { Global, Module } from "@nestjs/common";

import { BlocklistService } from "./blocklist.service.js";

@Global()
@Module({
  providers: [BlocklistService],
  exports: [BlocklistService],
})
export class BlocklistModule {}
