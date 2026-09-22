import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import nodemailer, { Transporter } from "nodemailer";
import { SettingsService } from "../settings/settings.service";
import { StoredSmtp } from "../settings/setting.keys";
import { decryptSecret } from "../settings/secret-box";
import { ConfigService } from "@nestjs/config";

export type OutboundMail = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
};

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** 未启用或未配 host/from 时返回原因，调用方记日志并完成 job。 */
  async send(mail: OutboundMail): Promise<"sent" | "skipped"> {
    const smtp = await this.settings.readStoredSmtp();
    if (!smtp.enabled || !smtp.host.trim() || !smtp.fromEmail.trim()) {
      this.logger.warn("SMTP 未启用或未配置，跳过发信");
      return "skipped";
    }
    if (mail.to.length === 0) {
      this.logger.warn("没有收件人，跳过发信");
      return "skipped";
    }
    const transport = this.createTransport(smtp);
    try {
      await transport.sendMail({
        from: formatFrom(smtp),
        to: mail.to,
        replyTo: smtp.replyTo || undefined,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      return "sent";
    } finally {
      transport.close();
    }
  }

  /** 管理端测试：未配置直接 400，连接/认证失败原样抛出。 */
  async sendTest(to: string, subject: string, text: string) {
    const smtp = await this.settings.readStoredSmtp();
    if (!smtp.enabled || !smtp.host.trim() || !smtp.fromEmail.trim()) {
      throw new BadRequestException({
        error: { code: "SMTP_NOT_CONFIGURED", message: "SMTP 未启用或未配置" },
      });
    }
    const transport = this.createTransport(smtp);
    try {
      await transport.sendMail({
        from: formatFrom(smtp),
        to,
        replyTo: smtp.replyTo || undefined,
        subject,
        text,
      });
    } finally {
      transport.close();
    }
  }

  private createTransport(smtp: StoredSmtp): Transporter {
    const password = smtp.passwordEnc ? decryptSecret(smtp.passwordEnc, this.config) : "";
    const timeoutMs = Math.max(1, smtp.connectTimeoutSec) * 1000;
    const secure = smtp.encryption === "ssl_tls";
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure,
      requireTLS: smtp.encryption === "starttls",
      auth: smtp.username ? { user: smtp.username, pass: password } : undefined,
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });
  }
}

function formatFrom(smtp: StoredSmtp): string {
  const name = smtp.fromName.trim();
  return name ? `"${name.replace(/"/g, "")}" <${smtp.fromEmail}>` : smtp.fromEmail;
}
