import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { MailerService } from "../notify/mailer.service";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService, MailerService],
  exports: [SettingsService, MailerService],
})
export class SettingsModule {}
