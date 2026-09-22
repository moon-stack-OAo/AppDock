import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { User } from "@prisma/client";
import { UserRole } from "@appdock/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuditService } from "../audit/audit.service";
import { MailerService } from "../notify/mailer.service";
import { PatchSettingsDto, SmtpTestDto } from "./dto/patch-settings.dto";
import { SettingsService } from "./settings.service";

@Controller("admin/settings")
@Roles(UserRole.Admin)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    return this.settings.getPublic();
  }

  @Patch()
  async patch(@CurrentUser() actor: User, @Body() dto: PatchSettingsDto) {
    const saved = await this.settings.patch(dto);
    if (dto.smtp) {
      await this.audit.record({
        actorUserId: actor.id,
        action: "settings.smtp_change",
        targetType: "settings",
        targetId: "smtp",
        meta: {
          enabled: saved.smtp.enabled,
          host: saved.smtp.host,
          port: saved.smtp.port,
          encryption: saved.smtp.encryption,
          username: saved.smtp.username,
          passwordSet: saved.smtp.passwordSet,
          fromEmail: saved.smtp.fromEmail,
        },
      });
    }
    return saved;
  }

  @Post("smtp/test")
  async test(@Body() dto: SmtpTestDto) {
    await this.mailer.sendTest(
      dto.to,
      "[AppDock] SMTP 测试",
      "这是 AppDock 的 SMTP 测试信。若收到此信，说明已保存的发信配置可用。",
    );
    return { ok: true };
  }
}
