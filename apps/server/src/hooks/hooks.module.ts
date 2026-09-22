import { Module } from "@nestjs/common";
import { SyncModule } from "../sync/sync.module";
import { HooksController } from "./hooks.controller";
import { HooksService } from "./hooks.service";

@Module({
  imports: [SyncModule],
  controllers: [HooksController],
  providers: [HooksService],
})
export class HooksModule {}
