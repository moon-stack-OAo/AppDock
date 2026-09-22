import { Module } from "@nestjs/common";
import { LocalStorageService } from "./local-storage.service";
import { STORAGE } from "./storage.interface";

@Module({
  providers: [
    LocalStorageService,
    { provide: STORAGE, useExisting: LocalStorageService },
  ],
  exports: [STORAGE, LocalStorageService],
})
export class StorageModule {}
