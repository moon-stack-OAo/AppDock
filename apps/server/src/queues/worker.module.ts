import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as path from "path";
import { PrismaModule } from "../prisma/prisma.module";
import { ProvidersModule } from "../providers/providers.module";
import { StorageModule } from "../storage/storage.module";
import { AuditModule } from "../audit/audit.module";
import { PollScheduler } from "../sync/poll.scheduler";
import { ReleaseSyncProcessor } from "../sync/release-sync.processor";
import { SyncService } from "../sync/sync.service";
import { WorkersBootstrap } from "./workers.bootstrap";
import { NotifyModule } from "../notify/notify.module";
import { QueueRegistry } from "./queue.registry";

/** 仅 Worker 进程导入。API 进程只入队，不 new Worker。 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "../../.env"),
        path.resolve(__dirname, "../../../.env"),
        path.resolve(__dirname, "../.env"),
      ],
    }),
    PrismaModule,
    ProvidersModule,
    StorageModule,
    AuditModule,
    NotifyModule,
  ],
  providers: [QueueRegistry, ReleaseSyncProcessor, SyncService, PollScheduler, WorkersBootstrap],
})
export class WorkerModule {}