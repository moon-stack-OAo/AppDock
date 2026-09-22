import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { User } from "@prisma/client";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { PatchNotifyDto } from "./dto/patch-notify.dto";
import { NotifyService } from "./notify.service";

@Controller("admin/apps/:id/notify")
export class NotifyController {
  constructor(private readonly notify: NotifyService) {}

  @Get()
  get(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.notify.getAppNotify(actor, id);
  }

  @Patch()
  patch(@CurrentUser() actor: User, @Param("id") id: string, @Body() dto: PatchNotifyDto) {
    return this.notify.patchAppNotify(actor, id, dto);
  }

  @Post("test")
  test(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.notify.testApp(actor, id);
  }
}
