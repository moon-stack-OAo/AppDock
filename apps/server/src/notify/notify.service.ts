import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AppPermission, UserRole } from "@appdock/shared";
import { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueueRegistry } from "../queues/queue.registry";
import { NotifyFileRef, NotifyPayload } from "../queues/queue.constants";
import { MEMBER_ROLES } from "../settings/setting.keys";
import { dedupeEmails, parseJsonEmails, SettingsService } from "../settings/settings.service";
import { MailerService } from "./mailer.service";

const ROLE_SET = new Set<string>(MEMBER_ROLES);

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueRegistry,
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
  ) {}

  /** 队列不可用只记 warn，不让上传/同步失败。 */
  async enqueue(payload: NotifyPayload) {
    try {
      await this.queues.notifyQueue().add(payload.event, payload);
    } catch (err) {
      this.logger.warn(`notify enqueue failed event=${payload.event}: ${(err as Error).message}`);
    }
  }

  async handle(payload: NotifyPayload) {
    const app = await this.prisma.app.findUnique({ where: { id: payload.appId } });
    if (!app) {
      this.logger.warn(`notify skip: app missing ${payload.appId}`);
      return;
    }
    if (!app.notifyEnabled) {
      this.logger.log(`notify skip: disabled app=${app.slug} event=${payload.event}`);
      return;
    }
    if (payload.event === "sync.success" && !app.notifyOnSyncSuccess) return;
    if (payload.event === "sync.failure" && !app.notifyOnSyncFailure) return;
    if (payload.event === "upload.success" && !app.notifyOnUploadSuccess) return;

    const to = await this.resolveRecipients(app);
    if (to.length === 0) {
      this.logger.warn(`notify skip: no recipients app=${app.slug} event=${payload.event}`);
      return;
    }
    const mail = await this.compose(app.name, app.slug, payload);
    await this.mailer.send({ to, ...mail });
  }

  async getAppNotify(actor: User, appId: string) {
    const app = await this.requireManager(actor, appId);
    return this.toNotifyView(app);
  }

  async patchAppNotify(
    actor: User,
    appId: string,
    input: {
      notifyEnabled?: boolean;
      notifyOnSyncSuccess?: boolean;
      notifyOnSyncFailure?: boolean;
      notifyOnUploadSuccess?: boolean;
      notifyEmails?: string[];
      notifyMemberRoles?: string[];
      notifyUseGlobalFallback?: boolean;
    },
  ) {
    await this.requireManager(actor, appId);
    const data: Record<string, unknown> = {};
    if (input.notifyEnabled !== undefined) data.notifyEnabled = input.notifyEnabled;
    if (input.notifyOnSyncSuccess !== undefined) data.notifyOnSyncSuccess = input.notifyOnSyncSuccess;
    if (input.notifyOnSyncFailure !== undefined) data.notifyOnSyncFailure = input.notifyOnSyncFailure;
    if (input.notifyOnUploadSuccess !== undefined) data.notifyOnUploadSuccess = input.notifyOnUploadSuccess;
    if (input.notifyUseGlobalFallback !== undefined) data.notifyUseGlobalFallback = input.notifyUseGlobalFallback;
    if (input.notifyEmails !== undefined) {
      data.notifyEmails = JSON.stringify(dedupeEmails(input.notifyEmails));
    }
    if (input.notifyMemberRoles !== undefined) {
      const roles = [...new Set(input.notifyMemberRoles.filter((role) => ROLE_SET.has(role)))];
      data.notifyMemberRoles = JSON.stringify(roles);
    }
    const app = await this.prisma.app.update({ where: { id: appId }, data });
    return this.toNotifyView(app);
  }

  /** 按当前收件人解析发测试信，在 API 进程直接发。 */
  async testApp(actor: User, appId: string) {
    const app = await this.requireManager(actor, appId);
    const to = await this.resolveRecipients(app);
    if (to.length === 0) {
      throw new BadRequestException({
        error: { code: "NO_RECIPIENTS", message: "没有可用收件人" },
      });
    }
    await this.mailer.sendTest(
      to.join(", "),
      `[AppDock] ${app.name} 通知测试`,
      `这是应用「${app.name}」的通知测试信。\n若收到此信，说明当前收件人解析与 SMTP 配置可用。`,
    );
    return { ok: true, recipients: to.length };
  }

  async resolveRecipients(app: {
    notifyEmails: string | null;
    notifyUseGlobalFallback: boolean;
    notifyMemberRoles: string | null;
    id: string;
  }): Promise<string[]> {
    const custom = parseJsonEmails(app.notifyEmails);
    const base =
      custom.length > 0 ? custom : app.notifyUseGlobalFallback ? await this.settings.notifyGlobalEmails() : [];
    const roles = parseJsonEmails(app.notifyMemberRoles).filter((role) => ROLE_SET.has(role));
    let memberEmails: string[] = [];
    if (roles.length > 0) {
      const members = await this.prisma.appMember.findMany({
        where: { appId: app.id, permission: { in: roles } },
        select: { user: { select: { email: true } } },
      });
      memberEmails = members.map((row) => row.user.email || "");
    }
    return dedupeEmails([...base, ...memberEmails]);
  }

  private async compose(appName: string, slug: string, payload: NotifyPayload) {
    const base = await this.settings.publicBaseUrl();
    const files = payload.files ?? [];
    const lines: string[] = [`应用：${appName}`];
    if (payload.tagName) lines.push(`版本：${payload.tagName}`);
    if (payload.syncJobId) lines.push(`任务：${payload.syncJobId}`);
    if (payload.event === "sync.failure") {
      lines.push(`错误：${payload.error || "同步失败"}`);
      if (base) lines.push(`任务列表：${base}/admin/jobs`);
    } else {
      if (payload.changelog) lines.push("", "更新说明：", clip(payload.changelog, 800));
      if (files.length) {
        lines.push("", "下载：");
        for (const file of files) {
          const url = downloadUrl(base, slug, file);
          lines.push(url ? `${file.name}  ${url}` : file.name);
        }
      }
    }
    const text = lines.join("\n");
    const subject =
      payload.event === "sync.failure"
        ? `[AppDock] ${appName} 同步失败`
        : payload.event === "upload.success"
          ? `[AppDock] ${appName} ${payload.tagName || ""} 上传成功`.replace(/\s+/g, " ").trim()
          : `[AppDock] ${appName} ${payload.tagName || ""} 同步成功`.replace(/\s+/g, " ").trim();
    return { subject, text, html: textToHtml(text) };
  }

  private toNotifyView(app: {
    notifyEnabled: boolean;
    notifyOnSyncSuccess: boolean;
    notifyOnSyncFailure: boolean;
    notifyOnUploadSuccess: boolean;
    notifyEmails: string | null;
    notifyMemberRoles: string | null;
    notifyUseGlobalFallback: boolean;
  }) {
    return {
      notifyEnabled: app.notifyEnabled,
      notifyOnSyncSuccess: app.notifyOnSyncSuccess,
      notifyOnSyncFailure: app.notifyOnSyncFailure,
      notifyOnUploadSuccess: app.notifyOnUploadSuccess,
      notifyEmails: parseJsonEmails(app.notifyEmails),
      notifyMemberRoles: parseJsonEmails(app.notifyMemberRoles).filter((role) => ROLE_SET.has(role)),
      notifyUseGlobalFallback: app.notifyUseGlobalFallback,
    };
  }

  private async requireManager(actor: User, appId: string) {
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "应用不存在" },
      });
    }
    if (actor.role === UserRole.Admin) return app;
    const member = await this.prisma.appMember.findUnique({
      where: { appId_userId: { appId, userId: actor.id } },
    });
    if (member?.permission !== AppPermission.Manager) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "需要应用管理员权限" },
      });
    }
    return app;
  }
}

function downloadUrl(base: string, slug: string, file: NotifyFileRef): string | null {
  if (!base || !file.assetId) return null;
  return `${base}/api/v1/public/apps/${encodeURIComponent(slug)}/assets/${encodeURIComponent(file.assetId)}/download`;
}

function clip(text: string, max: number) {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function textToHtml(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre style="font-family:sans-serif;white-space:pre-wrap">${escaped}</pre>`;
}
