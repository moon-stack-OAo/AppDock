import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ProvidersModule } from "../providers/providers.module";
import { QueueRegistry } from "../queues/queue.registry";
import { SyncController } from "./sync.controller";
import { SyncService } from "./sync.service";

@Module({
  imports: [AuditModule, ProvidersModule],
  controllers: [SyncController],
  providers: [SyncService, QueueRegistry],
  exports: [SyncService, QueueRegistry],
})
export class SyncModule {}
