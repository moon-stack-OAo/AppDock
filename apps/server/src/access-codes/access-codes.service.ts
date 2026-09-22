import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma, User } from "@prisma/client";
import { AppStatus, AppVisibility } from "@appdock/shared";
import { Response } from "express";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  codePrefixOf,
  decryptAccessCode,
  deriveMasterKey,
  encryptAccessCode,
  generatePlainCode,
  hashAccessCode,
  maskPrefix,
  verifyAccessCode,
} from "./access-code.crypto";
import { ACCESS_SESSION_COOKIE, type AccessCodeTokenPayload } from "./access-code.constants";
import { CreateAccessCodeDto } from "./dto/create-access-code.dto";
import { UpdateAccessCodeDto } from "./dto/update-access-code.dto";

const CODE_INCLUDE = {
  apps: { select: { appId: true, app: { select: { id: true, name: true, slug: true } } } },
  creator: { select: { id: true, username: true, displayName: true } },
} satisfies Prisma.AccessCodeInclude;

type CodeRow = Prisma.AccessCodeGetPayload<{ include: typeof CODE_INCLUDE }>;

export type AccessGrant = {
  codeId: string;
  allowedAppIds: string[];
};

@Injectable()
export class AccessCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  async list(page = 1, pageSize = 20) {
    const take = clampPageSize(pageSize);
    const skip = (Math.max(1, page) - 1) * take;
    const [rows, total] = await Promise.all([
      this.prisma.accessCode.findMany({
        include: CODE_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      this.prisma.accessCode.count(),
    ]);
    return {
      items: rows.map((row) => this.toListItem(row)),
      total,
      page: Math.max(1, page),
      pageSize: take,
    };
  }

  async create(actor: User, dto: CreateAccessCodeDto) {
    const appIds = await this.assertPasswordApps(dto.appIds);
    const plain = this.resolvePlain(dto.customCode);
    await this.assertHashFree(plain);
    const master = this.requireMasterKey();
    const created = await this.prisma.accessCode.create({
      data: {
        note: dto.note?.trim() ?? "",
        codeHash: hashAccessCode(plain),
        codeEnc: encryptAccessCode(plain, master),
        codePrefix: codePrefixOf(plain),
        status: "active",
        expiresAt: this.parseExpires(dto.expiresAt),
        maxUses: dto.maxUses ?? null,
        createdByUserId: actor.id,
        apps: { create: appIds.map((appId) => ({ appId })) },
      },
      include: CODE_INCLUDE,
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: "access_code.create",
      targetType: "access_code",
      targetId: created.id,
      meta: { prefix: created.codePrefix, appIds },
    });
    return {
      id: created.id,
      plainCode: plain,
      prefix: created.codePrefix,
      item: this.toListItem(created),
    };
  }

  async update(actor: User, id: string, dto: UpdateAccessCodeDto) {
    const existing = await this.requireRow(id);
    const data: Prisma.AccessCodeUpdateInput = {};
    if (dto.note !== undefined) data.note = dto.note.trim();
    if (dto.expiresAt !== undefined) data.expiresAt = this.parseExpires(dto.expiresAt);
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.status !== undefined) data.status = dto.status;
    let appIds: string[] | undefined;
    if (dto.appIds !== undefined) {
      appIds = await this.assertPasswordApps(dto.appIds);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (appIds) {
        await tx.accessCodeApp.deleteMany({ where: { accessCodeId: id } });
        if (appIds.length > 0) {
          await tx.accessCodeApp.createMany({
            data: appIds.map((appId) => ({ accessCodeId: id, appId })),
          });
        }
      }
      return tx.accessCode.update({
        where: { id },
        data,
        include: CODE_INCLUDE,
      });
    });
    const action = dto.status === "disabled" && existing.status !== "disabled"
      ? "access_code.disable"
      : "access_code.update";
    await this.audit.record({
      actorUserId: actor.id,
      action,
      targetType: "access_code",
      targetId: id,
      meta: {
        prefix: updated.codePrefix,
        status: updated.status,
        ...(appIds ? { appIds } : {}),
      },
    });
    return this.toListItem(updated);
  }

  async rotate(actor: User, id: string) {
    await this.requireRow(id);
    const plain = generatePlainCode();
    await this.assertHashFree(plain);
    const master = this.requireMasterKey();
    const updated = await this.prisma.accessCode.update({
      where: { id },
      data: {
        codeHash: hashAccessCode(plain),
        codeEnc: encryptAccessCode(plain, master),
        codePrefix: codePrefixOf(plain),
        status: "active",
        usedCount: 0,
        lastUsedAt: null,
      },
      include: CODE_INCLUDE,
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: "access_code.rotate",
      targetType: "access_code",
      targetId: id,
      meta: { prefix: updated.codePrefix },
    });
    return {
      id: updated.id,
      plainCode: plain,
      prefix: updated.codePrefix,
      item: this.toListItem(updated),
    };
  }

  async reveal(actor: User, id: string) {
    const row = await this.requireRow(id);
    const master = this.requireMasterKey();
    let plain: string;
    try {
      plain = decryptAccessCode(row.codeEnc, master);
    } catch {
      throw new GoneException({
        error: { code: "CODE_UNREADABLE", message: "口令无法解密，请轮换后重新分发" },
      });
    }
    await this.audit.record({
      actorUserId: actor.id,
      action: "access_code.reveal",
      targetType: "access_code",
      targetId: id,
      meta: { prefix: row.codePrefix },
    });
    return { plainCode: plain };
  }

  async disable(actor: User, id: string) {
    return this.update(actor, id, { status: "disabled" });
  }

  async listBoundForApp(appId: string) {
    const rows = await this.prisma.accessCodeApp.findMany({
      where: { appId },
      include: {
        accessCode: {
          select: {
            id: true,
            note: true,
            codePrefix: true,
            status: true,
            expiresAt: true,
            maxUses: true,
            usedCount: true,
          },
        },
      },
      orderBy: { accessCode: { createdAt: "desc" } },
    });
    return rows.map((row) => ({
      id: row.accessCode.id,
      note: row.accessCode.note,
      prefix: maskPrefix(row.accessCode.codePrefix),
      status: this.effectiveStatus(row.accessCode),
      expiresAt: row.accessCode.expiresAt,
    }));
  }

  /**
   * 仅 password 且 active 的应用可解锁。失败一律 401，不区分原因。
   * 成功后 usedCount++ 并签发独立 cookie。
   */
  async unlock(slug: string, plain: string, res: Response) {
    const invalid = new UnauthorizedException({
      error: { code: "INVALID_ACCESS_CODE", message: "口令无效或已失效" },
    });
    const app = await this.prisma.app.findUnique({ where: { slug } });
    if (
      !app ||
      app.status !== AppStatus.Active ||
      app.visibility !== AppVisibility.Password
    ) {
      throw invalid;
    }
    const bindings = await this.prisma.accessCodeApp.findMany({
      where: { appId: app.id },
      include: { accessCode: { include: { apps: { select: { appId: true } } } } },
    });
    const now = new Date();
    let matched: (typeof bindings)[number] | null = null;
    for (const binding of bindings) {
      const code = binding.accessCode;
      if (!this.isUsable(code, now)) continue;
      if (verifyAccessCode(plain, code.codeHash)) {
        matched = binding;
        break;
      }
    }
    if (!matched) throw invalid;

    const updated = await this.prisma.accessCode.update({
      where: { id: matched.accessCode.id },
      data: { usedCount: { increment: 1 }, lastUsedAt: now },
    });
    if (!this.isUsable({ ...matched.accessCode, usedCount: updated.usedCount }, now)) {
      throw invalid;
    }

    const allowedAppIds = matched.accessCode.apps.map((item) => item.appId);
    const ttl = this.sessionTtlSec();
    const token = await this.jwt.signAsync(
      {
        codeId: matched.accessCode.id,
        allowedAppIds,
        typ: "access_code",
        aud: "access_code",
      } satisfies AccessCodeTokenPayload,
      {
        secret: this.config.getOrThrow<string>("APPDOCK_JWT_SECRET"),
        expiresIn: ttl,
        algorithm: "HS256",
        audience: "access_code",
      },
    );
    const secure = (this.config.get<string>("APPDOCK_PUBLIC_BASE_URL") ?? "").startsWith("https://");
    res.cookie(ACCESS_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: ttl * 1000,
      secure,
    });
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    return { ok: true as const, expiresAt };
  }

  lock(res: Response) {
    res.clearCookie(ACCESS_SESSION_COOKIE, { path: "/" });
    return { ok: true as const };
  }

  /** cookie 已声明允许该应用时，再确认口令未停用、未过期、未超次。停用后旧 cookie 一期仍带到过期，但下载时拒绝。 */
  async grantStillValid(cookieAppIds: string[], appId: string, codeId?: string): Promise<boolean> {
    if (!cookieAppIds.includes(appId) || !codeId) return false;
    const code = await this.prisma.accessCode.findUnique({ where: { id: codeId } });
    if (!code || !this.isUsable(code, new Date())) return false;
    return true;
  }

  private isUsable(
    code: { status: string; expiresAt: Date | null; maxUses: number | null; usedCount: number },
    now: Date,
  ) {
    if (code.status !== "active") return false;
    if (code.expiresAt && code.expiresAt.getTime() <= now.getTime()) return false;
    if (code.maxUses != null && code.usedCount >= code.maxUses) return false;
    return true;
  }

  private effectiveStatus(code: {
    status: string;
    expiresAt: Date | null;
    maxUses: number | null;
    usedCount: number;
  }) {
    if (code.status === "disabled") return "disabled";
    if (code.expiresAt && code.expiresAt.getTime() <= Date.now()) return "expired";
    if (code.maxUses != null && code.usedCount >= code.maxUses) return "expired";
    return "active";
  }

  private toListItem(row: CodeRow) {
    return {
      id: row.id,
      note: row.note,
      prefix: maskPrefix(row.codePrefix),
      status: this.effectiveStatus(row),
      storedStatus: row.status,
      expiresAt: row.expiresAt,
      maxUses: row.maxUses,
      usedCount: row.usedCount,
      lastUsedAt: row.lastUsedAt,
      appIds: row.apps.map((item) => item.appId),
      apps: row.apps.map((item) => item.app),
      createdBy: row.creator
        ? {
            id: row.creator.id,
            username: row.creator.username,
            displayName: row.creator.displayName,
          }
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async requireRow(id: string) {
    const row = await this.prisma.accessCode.findUnique({
      where: { id },
      include: CODE_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "口令不存在" },
      });
    }
    return row;
  }

  private async assertPasswordApps(appIds: string[]) {
    const unique = [...new Set(appIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "至少绑定一个口令可见的应用" },
      });
    }
    const apps = await this.prisma.app.findMany({
      where: { id: { in: unique } },
      select: { id: true, visibility: true, status: true },
    });
    if (apps.length !== unique.length) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "绑定的应用不存在" },
      });
    }
    const bad = apps.find(
      (app) => app.visibility !== AppVisibility.Password || app.status !== AppStatus.Active,
    );
    if (bad) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "只能绑定可见性为口令且未归档的应用" },
      });
    }
    return unique;
  }

  private resolvePlain(customCode: string | null | undefined) {
    const custom = customCode?.trim();
    if (!custom) return generatePlainCode();
    if (custom.length < 10) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "自定义口令至少 10 个字符" },
      });
    }
    return custom;
  }

  private async assertHashFree(plain: string) {
    const rows = await this.prisma.accessCode.findMany({ select: { codeHash: true } });
    for (const row of rows) {
      if (verifyAccessCode(plain, row.codeHash)) {
        throw new BadRequestException({
          error: { code: "BAD_REQUEST", message: "口令已存在" },
        });
      }
    }
  }

  private parseExpires(value: string | null | undefined): Date | null {
    if (value == null || value === "") return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "过期时间格式无效" },
      });
    }
    return date;
  }

  private requireMasterKey(): Buffer {
    const raw = this.config.get<string>("APPDOCK_ACCESS_CODE_MASTER_KEY")?.trim();
    if (!raw) {
      throw new ServiceUnavailableException({
        error: { code: "MASTER_KEY_MISSING", message: "未配置口令主密钥，无法签发或读取明文" },
      });
    }
    return deriveMasterKey(raw);
  }

  private sessionTtlSec() {
    const raw = Number(this.config.get("APPDOCK_ACCESS_CODE_SESSION_TTL_SEC") ?? 604800);
    return Number.isFinite(raw) && raw > 0 ? raw : 604800;
  }
}

function clampPageSize(pageSize: number) {
  if (!Number.isFinite(pageSize) || pageSize < 1) return 20;
  return Math.min(100, Math.floor(pageSize));
}
