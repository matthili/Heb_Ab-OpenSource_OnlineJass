import { Global, Module } from "@nestjs/common";

import { MailService } from "./mail.service.js";
import { SmtpSettingsService } from "./smtp-settings.service.js";

@Global()
@Module({
  providers: [MailService, SmtpSettingsService],
  exports: [MailService, SmtpSettingsService],
})
export class MailModule {}
