import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as path from "path";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { AuditModule } from "./audit/audit.module";
import { StorageModule } from "./storage/storage.module";
import { AppsModule } from "./apps/apps.module";
import { VersionsModule } from "./versions/versions.module";
import { SyncModule } from "./sync/sync.module";
import { HooksModule } from "./hooks/hooks.module";
import { AccessCodesModule } from "./access-codes/access-codes.module";
import { SettingsModule } from "./settings/settings.module";
import { NotifyModule } from "./notify/notify.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 仓库根 .env 优先，其次 apps/server/.env
      envFilePath: [
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "../../.env"),
        path.resolve(__dirname, "../../../.env"),
        path.resolve(__dirname, "../.env"),
      ],
    }),
    PrismaModule,
    AuditModule,
    StorageModule,
    HealthModule,
    UsersModule,
    AuthModule,
    AppsModule,
    VersionsModule,
    AccessCodesModule,
    SyncModule,
    HooksModule,
    SettingsModule,
    NotifyModule,
    MaintenanceModule,
  ],
})
export class AppModule {}
