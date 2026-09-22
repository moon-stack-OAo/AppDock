import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { PublicSettings, PublicSmtp, SETTING_KEYS, StoredSmtp } from "./setting.keys";
import { encryptSecret } from "./secret-box";

const DEFAULT_POLL = 300;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.seedDefaults();
    } catch (err) {
      this.logger.warn(`settings seed skipped: ${(err as Error).message}`);
    }
  }

  /** 仅当对应键不存在时写入环境变量默认值，已有行不覆盖。 */
  async seedDefaults() {
    const existing = await this.prisma.setting.findMany({ select: { key: true } });
    const have = new Set(existing.map((row) => row.key));
    const pairs: Array<[string, string]> = [];

    const siteName = this.config.get<string>("APPDOCK_SITE_NAME")?.trim() || "AppDock";
    if (!have.has(SETTING_KEYS.siteName)) pairs.push([SETTING_KEYS.siteName, siteName]);

    const base = this.config.get<string>("APPDOCK_PUBLIC_BASE_URL")?.trim() || "";
    if (!have.has(SETTING_KEYS.publicBaseUrl)) pairs.push([SETTING_KEYS.publicBaseUrl, base]);

    const poll = positiveInt(this.config.get("APPDOCK_DEFAULT_POLL_INTERVAL_SEC"), DEFAULT_POLL);
    if (!have.has(SETTING_KEYS.defaultPollIntervalSec)) {
      pairs.push([SETTING_KEYS.defaultPollIntervalSec, String(poll)]);
    }

    const max = positiveInt(this.config.get("APPDOCK_MAX_ASSET_SIZE_BYTES"), DEFAULT_MAX_BYTES);
    if (!have.has(SETTING_KEYS.maxAssetSizeBytes)) {
      pairs.push([SETTING_KEYS.maxAssetSizeBytes, String(max)]);
    }

    if (!have.has(SETTING_KEYS.notifyGlobalEmails)) {
      pairs.push([SETTING_KEYS.notifyGlobalEmails, JSON.stringify(parseEmailList(this.config.get("APPDOCK_NOTIFY_GLOBAL_EMAILS")))]);
    }

    if (!have.has(SETTING_KEYS.smtp)) {
      pairs.push([SETTING_KEYS.smtp, JSON.stringify(this.smtpFromEnv())]);
    }

    if (pairs.length === 0) return;
    await this.prisma.setting.createMany({
      data: pairs.map(([key, value]) => ({ key, value })),
    });
    this.logger.log(`settings seeded: ${pairs.map(([key]) => key).join(", ")}`);
  }

  async getPublic(): Promise<PublicSettings> {
    await this.seedDefaults();
    const map = await this.readMap();
    return {
      siteName: map.get(SETTING_KEYS.siteName) || "AppDock",
      publicBaseUrl: (map.get(SETTING_KEYS.publicBaseUrl) || "").replace(/\/$/, ""),
      defaultPollIntervalSec: positiveInt(map.get(SETTING_KEYS.defaultPollIntervalSec), DEFAULT_POLL),
      maxAssetSizeBytes: positiveInt(map.get(SETTING_KEYS.maxAssetSizeBytes), DEFAULT_MAX_BYTES),
      storageRoot: this.config.get<string>("APPDOCK_STORAGE_ROOT") || "",
      notifyGlobalEmails: parseJsonEmails(map.get(SETTING_KEYS.notifyGlobalEmails)),
      smtp: toPublic(this.readSmtp(map)),
    };
  }

  async publicBaseUrl(): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.publicBaseUrl } });
    const stored = row?.value?.trim();
    if (stored) return stored.replace(/\/$/, "");
    return (this.config.get<string>("APPDOCK_PUBLIC_BASE_URL") || "").replace(/\/$/, "");
  }

  async notifyGlobalEmails(): Promise<string[]> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.notifyGlobalEmails } });
    return parseJsonEmails(row?.value);
  }

  async readStoredSmtp(): Promise<StoredSmtp> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.smtp } });
    if (!row) return this.smtpFromEnv();
    return parseSmtp(row.value);
  }

  /** 已启用且 host、fromEmail 都有。健康检查不连 SMTP。 */
  async smtpConfigured(): Promise<boolean> {
    const smtp = await this.readStoredSmtp();
    return Boolean(smtp.enabled && smtp.host.trim() && smtp.fromEmail.trim());
  }

  async patch(input: {
    siteName?: string;
    publicBaseUrl?: string;
    defaultPollIntervalSec?: number;
    maxAssetSizeBytes?: number;
    notifyGlobalEmails?: string[];
    smtp?: Partial<StoredSmtp> & { password?: string | null };
  }): Promise<PublicSettings> {
    await this.seedDefaults();
    const writes: Array<[string, string]> = [];
    if (input.siteName !== undefined) writes.push([SETTING_KEYS.siteName, input.siteName.trim() || "AppDock"]);
    if (input.publicBaseUrl !== undefined) {
      writes.push([SETTING_KEYS.publicBaseUrl, input.publicBaseUrl.trim().replace(/\/$/, "")]);
    }
    if (input.defaultPollIntervalSec !== undefined) {
      writes.push([SETTING_KEYS.defaultPollIntervalSec, String(input.defaultPollIntervalSec)]);
    }
    if (input.maxAssetSizeBytes !== undefined) {
      writes.push([SETTING_KEYS.maxAssetSizeBytes, String(input.maxAssetSizeBytes)]);
    }
    if (input.notifyGlobalEmails !== undefined) {
      writes.push([SETTING_KEYS.notifyGlobalEmails, JSON.stringify(input.notifyGlobalEmails)]);
    }
    if (input.smtp) {
      const current = await this.readStoredSmtp();
      const next = mergeSmtp(current, input.smtp, this.config);
      writes.push([SETTING_KEYS.smtp, JSON.stringify(next)]);
    }
    await Promise.all(
      writes.map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        }),
      ),
    );
    return this.getPublic();
  }

  private async readMap() {
    const rows = await this.prisma.setting.findMany();
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  private readSmtp(map: Map<string, string>): StoredSmtp {
    const raw = map.get(SETTING_KEYS.smtp);
    if (!raw) return emptySmtp();
    return parseSmtp(raw);
  }

  private smtpFromEnv(): StoredSmtp {
    const pass = this.config.get<string>("APPDOCK_SMTP_PASS")?.trim() || "";
    const encryption = normalizeEncryption(this.config.get<string>("APPDOCK_SMTP_ENCRYPTION"));
    const enabledRaw = this.config.get<string>("APPDOCK_SMTP_ENABLED");
    return {
      enabled: enabledRaw === "true" || enabledRaw === "1",
      host: this.config.get<string>("APPDOCK_SMTP_HOST")?.trim() || "",
      port: positiveInt(this.config.get("APPDOCK_SMTP_PORT"), 587),
      encryption,
      username: this.config.get<string>("APPDOCK_SMTP_USER")?.trim() || "",
      passwordEnc: pass ? encryptSecret(pass, this.config) : null,
      fromName: this.config.get<string>("APPDOCK_SMTP_FROM_NAME")?.trim() || "AppDock",
      fromEmail: this.config.get<string>("APPDOCK_SMTP_FROM_EMAIL")?.trim() || "",
      replyTo: this.config.get<string>("APPDOCK_SMTP_REPLY_TO")?.trim() || null,
      connectTimeoutSec: positiveInt(this.config.get("APPDOCK_SMTP_CONNECT_TIMEOUT_SEC"), 15),
    };
  }
}

function emptySmtp(): StoredSmtp {
  return {
    enabled: false,
    host: "",
    port: 587,
    encryption: "starttls",
    username: "",
    passwordEnc: null,
    fromName: "AppDock",
    fromEmail: "",
    replyTo: null,
    connectTimeoutSec: 15,
  };
}

function parseSmtp(raw: string): StoredSmtp {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSmtp>;
    return {
      enabled: Boolean(parsed.enabled),
      host: typeof parsed.host === "string" ? parsed.host : "",
      port: positiveInt(parsed.port, 587),
      encryption: normalizeEncryption(parsed.encryption),
      username: typeof parsed.username === "string" ? parsed.username : "",
      passwordEnc: typeof parsed.passwordEnc === "string" && parsed.passwordEnc ? parsed.passwordEnc : null,
      fromName: typeof parsed.fromName === "string" ? parsed.fromName : "AppDock",
      fromEmail: typeof parsed.fromEmail === "string" ? parsed.fromEmail : "",
      replyTo: typeof parsed.replyTo === "string" && parsed.replyTo ? parsed.replyTo : null,
      connectTimeoutSec: positiveInt(parsed.connectTimeoutSec, 15),
    };
  } catch {
    return emptySmtp();
  }
}

function mergeSmtp(
  current: StoredSmtp,
  patch: Partial<StoredSmtp> & { password?: string | null },
  config: ConfigService,
): StoredSmtp {
  let passwordEnc = current.passwordEnc;
  if (patch.password !== undefined) {
    const next = patch.password ?? "";
    passwordEnc = next.trim() ? encryptSecret(next, config) : null;
  }
  return {
    enabled: patch.enabled ?? current.enabled,
    host: patch.host !== undefined ? patch.host.trim() : current.host,
    port: patch.port !== undefined ? positiveInt(patch.port, 587) : current.port,
    encryption: patch.encryption ? normalizeEncryption(patch.encryption) : current.encryption,
    username: patch.username !== undefined ? patch.username.trim() : current.username,
    passwordEnc,
    fromName: patch.fromName !== undefined ? patch.fromName.trim() : current.fromName,
    fromEmail: patch.fromEmail !== undefined ? patch.fromEmail.trim() : current.fromEmail,
    replyTo: patch.replyTo !== undefined ? (patch.replyTo?.trim() || null) : current.replyTo,
    connectTimeoutSec:
      patch.connectTimeoutSec !== undefined ? positiveInt(patch.connectTimeoutSec, 15) : current.connectTimeoutSec,
  };
}

function toPublic(smtp: StoredSmtp): PublicSmtp {
  return {
    enabled: smtp.enabled,
    host: smtp.host,
    port: smtp.port,
    encryption: smtp.encryption,
    username: smtp.username,
    passwordSet: Boolean(smtp.passwordEnc),
    fromName: smtp.fromName,
    fromEmail: smtp.fromEmail,
    replyTo: smtp.replyTo,
    connectTimeoutSec: smtp.connectTimeoutSec,
  };
}

export function parseEmailList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return dedupeEmails(raw.map((item) => String(item)));
  }
  if (typeof raw !== "string" || !raw.trim()) return [];
  return dedupeEmails(raw.split(/[\s,;]+/));
}

export function parseJsonEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return parseEmailList(JSON.parse(raw));
  } catch {
    return parseEmailList(raw);
  }
}

export function dedupeEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = value.trim();
    if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function normalizeEncryption(raw: unknown): StoredSmtp["encryption"] {
  if (raw === "ssl_tls" || raw === "starttls" || raw === "none") return raw;
  return "starttls";
}

function positiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}
