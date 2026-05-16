import { Global, Module } from "@nestjs/common";

import { InferenceClient } from "./inference-client.service.js";

@Global()
@Module({
  providers: [InferenceClient],
  exports: [InferenceClient],
})
export class InferenceModule {}
