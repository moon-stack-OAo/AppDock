import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AccessCodesModule } from "../access-codes/access-codes.module";
import { StorageModule } from "../storage/storage.module";
import { AppsService } from "./apps.service";
import { AppsController } from "./apps.controller";

@Module({
  imports: [AuditModule, StorageModule, AccessCodesModule],
  controllers: [AppsController],
  providers: [AppsService],
  exports: [AppsService],
})
export class AppsModule {}
