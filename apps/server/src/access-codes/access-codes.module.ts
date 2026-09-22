import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuditModule } from "../audit/audit.module";
import { AccessCodesController } from "./access-codes.controller";
import { AccessCodesService } from "./access-codes.service";

@Module({
  imports: [AuditModule, JwtModule],
  controllers: [AccessCodesController],
  providers: [AccessCodesService],
  exports: [AccessCodesService],
})
export class AccessCodesModule {}
