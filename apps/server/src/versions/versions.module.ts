import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";
import { UsersModule } from "../users/users.module";
import { AccessCodesModule } from "../access-codes/access-codes.module";
import { NotifyModule } from "../notify/notify.module";
import { PublicDownloadsController } from "./public-downloads.controller";
import { VersionsController } from "./versions.controller";
import { VersionsService } from "./versions.service";

@Module({
  imports: [AuditModule, StorageModule, UsersModule, JwtModule, AccessCodesModule, NotifyModule],
  controllers: [VersionsController, PublicDownloadsController],
  providers: [VersionsService],
})
export class VersionsModule {}
