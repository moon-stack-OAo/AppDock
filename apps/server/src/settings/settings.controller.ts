import { BadRequestException, Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { User } from "@prisma/client";
import { UserRole } from "@appdock/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuditService } from "../audit/audit.service";
import { MailerService } from "../notify/mailer.service";
import { PatchSettingsDto, SmtpTestDto } from "./dto/patch-settings.dto";
import { StoredSmtp } from "./setting.keys";
import { encryptSecret } from "./secret-box";
import { SettingsService } from "./settings.service";
import { ConfigService } from "@nestjs/config";

@Controller("admin/settings")
@Roles(UserRole.Admin)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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
    const stored = await this.settings.readStoredSmtp();
    const draft = dto.smtp ? this.draftSmtp(stored, dto.smtp) : stored;
    const to =
      dto.to?.trim() ||
      (await this.settings.getPublic()).notifyGlobalEmails[0] ||
      "";
    if (!to) {
      throw new BadRequestException({
        error: { code: "NO_RECIPIENTS", message: "请填写全局默认收件人" },
      });
    }
    await this.mailer.sendTest(
      to,
      "[AppDock] SMTP 测试",
      "这是 AppDock 的 SMTP 测试信。若收到此信，说明当前表单中的发信配置可用。",
      draft,
    );
    return { ok: true, to };
  }

  private draftSmtp(stored: StoredSmtp, patch: NonNullable<SmtpTestDto["smtp"]>): StoredSmtp {
    const password =
      patch.password !== undefined
        ? patch.password.trim()
          ? encryptSecret(patch.password, this.config)
          : null
        : stored.passwordEnc;
    return {
      enabled: patch.enabled ?? stored.enabled,
      host: patch.host !== undefined ? patch.host.trim() : stored.host,
      port: patch.port ?? stored.port,
      encryption: patch.encryption ?? stored.encryption,
      username: patch.username !== undefined ? patch.username.trim() : stored.username,
      passwordEnc: password,
      fromName: patch.fromName !== undefined ? patch.fromName.trim() : stored.fromName,
      fromEmail: patch.fromEmail !== undefined ? patch.fromEmail.trim() : stored.fromEmail,
      replyTo: patch.replyTo !== undefined ? patch.replyTo?.trim() || null : stored.replyTo,
      connectTimeoutSec: patch.connectTimeoutSec ?? stored.connectTimeoutSec,
    };
  }
}
