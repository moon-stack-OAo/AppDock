import { Module } from "@nestjs/common";
import { QueueRegistry } from "../queues/queue.registry";
import { SettingsModule } from "../settings/settings.module";
import { NotifyController } from "./notify.controller";
import { NotifyService } from "./notify.service";

@Module({
  imports: [SettingsModule],
  controllers: [NotifyController],
  providers: [NotifyService, QueueRegistry],
  exports: [NotifyService],
})
export class NotifyModule {}
