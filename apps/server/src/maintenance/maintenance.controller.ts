import { Controller, Post } from "@nestjs/common";
import { UserRole } from "@appdock/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { MaintenanceService } from "./maintenance.service";

@Controller("admin/maintenance")
@Roles(UserRole.Admin)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Post("backup")
  backup() {
    return this.maintenance.backupDatabase();
  }
}
