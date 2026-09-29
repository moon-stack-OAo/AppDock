import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, User } from "@prisma/client";
import {
  API_PREFIX,
  AppPermission,
  AppStatus,
  AppVisibility,
  ReleaseProvider,
  UserRole,
  UserStatus,
  isReleaseProviderImplemented,
} from "@appdock/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AccessCodesService } from "../access-codes/access-codes.service";
import { STORAGE, Storage } from "../storage/storage.interface";
import { LocalStorageService } from "../storage/local-storage.service";
import { CreateAppDto } from "./dto/create-app.dto";
import { UpdateAppDto } from "./dto/update-app.dto";
import { UpsertMemberDto } from "./dto/upsert-member.dto";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const APP_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  releaseProvider: true,
  releaseOwner: true,
  releaseRepo: true,
  releaseBaseUrl: true,
  releaseProjectId: true,
  visibility: true,
  status: true,
  sortOrder: true,
  storagePrefix: true,
  syncWebhookEnabled: true,
  syncPollEnabled: true,
  syncPollIntervalSec: true,
  assetIncludeGlob: true,
  assetExcludeGlob: true,
  platformRulesJson: true,
  latestReleaseOnly: true,
  iconUrl: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AppSelect;

type AppRow = Prisma.AppGetPayload<{ select: typeof APP_FIELDS }>;

export type AppView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  releaseProvider: string;
  releaseOwner: string | null;
  releaseRepo: string | null;
  releaseBaseUrl: string | null;
  releaseProjectId: string | null;
  visibility: string;
  status: string;
  sortOrder: number;
  storagePrefix: string | null;
  syncWebhookEnabled: boolean;
  syncPollEnabled: boolean;
  syncPollIntervalSec: number | null;
  assetIncludeGlob: string | null;
  assetExcludeGlob: string | null;
  platformRules: unknown;
  latestReleaseOnly: boolean;
  iconUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  myPermission: "admin" | AppPermission;
};

export type BoundAccessCode = {
  id: string;
  note: string;
  prefix: string;
  status: string;
  expiresAt: Date | null;
};

export type AppDetailView = AppView & {
  webhookUrl: string | null;
  providerStatus: "manual" | "implemented" | "not_implemented";
  boundAccessCodes: BoundAccessCode[];
};

export type AppMutationResult = AppView & { warning?: string };
export type AppDetailMutationResult = AppDetailView & { warning?: string };

const RANK: Record<string, number> = {
  [AppPermission.Viewer]: 1,
  [AppPermission.Operator]: 2,
  [AppPermission.Manager]: 3,
};

@Injectable()
export class AppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly localStorage: LocalStorageService,
    private readonly accessCodes: AccessCodesService,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  async list(actor: User): Promise<AppView[]> {
    const isAdmin = actor.role === UserRole.Admin;
    const rows = await this.prisma.app.findMany({
      where: isAdmin ? undefined : { members: { some: { userId: actor.id } } },
      select: {
        ...APP_FIELDS,
        members: isAdmin
          ? false
          : { where: { userId: actor.id }, select: { permission: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return rows.map((row) => {
      const members = "members" in row ? row.members : undefined;
      const perm = isAdmin
        ? ("admin" as const)
        : ((members?.[0]?.permission as AppPermission | undefined) ??
          AppPermission.Viewer);
      return this.toView(row, perm);
    });
  }

  async get(actor: User, id: string): Promise<AppDetailView> {
    const app = await this.requireApp(id);
    const perm = await this.requireAtLeast(actor, app.id, AppPermission.Viewer);
    return this.toDetail(app, perm);
  }

  async previewRelease(actor: User, rawUrl: string) {
    if (actor.role !== UserRole.Admin) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "仅管理员可解析 Release 地址" },
      });
    }
    const parsed = this.parseGithubUrl(rawUrl);
    const meta = await this.fetchGithubRepo(parsed.owner, parsed.repo);
    const slug = this.suggestSlug(meta.name || parsed.repo);
    return {
      releaseProvider: ReleaseProvider.Github,
      releaseOwner: parsed.owner,
      releaseRepo: parsed.repo,
      name: this.shortName(meta.name || parsed.repo),
      slug,
      description: meta.description,
      iconUrl: meta.iconUrl,
      private: meta.private,
      htmlUrl: meta.htmlUrl,
    };
  }

  async create(actor: User, dto: CreateAppDto): Promise<AppMutationResult> {
    if (actor.role !== UserRole.Admin) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "仅管理员可创建应用" },
      });
    }

    const name = dto.name.trim();
    const slug = dto.slug.trim();
    this.assertName(name);
    this.assertSlug(slug);

    const mapped = this.mapReleaseAliases(dto);
    const releaseProvider = mapped.releaseProvider ?? ReleaseProvider.None;
    this.assertProvider(releaseProvider);
    const visibility = dto.visibility ?? AppVisibility.Login;
    this.assertVisibility(visibility);

    const releaseOwner = this.emptyToNull(mapped.releaseOwner);
    const releaseRepo = this.emptyToNull(mapped.releaseRepo);
    const releaseBaseUrl = this.emptyToNull(mapped.releaseBaseUrl);
    this.assertReleaseRef(releaseProvider, releaseOwner, releaseRepo);

    let syncWebhookEnabled = dto.syncWebhookEnabled ?? false;
    let syncPollEnabled = dto.syncPollEnabled ?? false;
    let warning: string | undefined;

    if (releaseProvider === ReleaseProvider.None) {
      if (syncWebhookEnabled || syncPollEnabled) {
        throw new BadRequestException({
          error: {
            code: "SYNC_REQUIRES_PROVIDER",
            message: "未配置 Release Provider 时不能开启同步",
          },
        });
      }
    } else if (!isReleaseProviderImplemented(releaseProvider)) {
      if (syncWebhookEnabled || syncPollEnabled) {
        syncWebhookEnabled = false;
        syncPollEnabled = false;
        warning = "PROVIDER_NOT_IMPLEMENTED";
      }
    }

    await this.assertSlugFree(slug);
    if (releaseProvider !== ReleaseProvider.None) {
      await this.assertReleaseRefFree(
        releaseProvider,
        releaseOwner,
        releaseRepo,
        releaseBaseUrl,
      );
    }

    const storagePrefix = (dto.storagePrefix?.trim() || slug).replace(/\\/g, "/");
    this.assertStoragePrefix(storagePrefix);

    const created = await this.prisma.app.create({
      data: {
        name,
        slug,
        description: this.emptyToNull(dto.description),
        releaseProvider,
        releaseOwner,
        releaseRepo,
        releaseBaseUrl,
        releaseProjectId: this.emptyToNull(dto.releaseProjectId),
        visibility,
        syncWebhookEnabled,
        syncPollEnabled,
        syncPollIntervalSec: dto.syncPollIntervalSec ?? null,
        assetIncludeGlob: this.emptyToNull(dto.assetIncludeGlob),
        assetExcludeGlob: this.emptyToNull(dto.assetExcludeGlob),
        latestReleaseOnly: dto.latestReleaseOnly ?? false,
        storagePrefix,
        iconUrl: this.emptyToNull(dto.iconUrl),
        sortOrder: dto.sortOrder ?? 0,
        platformRulesJson:
          dto.platformRules === undefined ? null : JSON.stringify(dto.platformRules),
        status: AppStatus.Active,
      },
      select: APP_FIELDS,
    });

    await this.storage.ensurePrefix(storagePrefix);

    await this.audit.record({
      actorUserId: actor.id,
      action: "app.create",
      targetType: "app",
      targetId: created.id,
      meta: {
        slug: created.slug,
        visibility: created.visibility,
        releaseProvider: created.releaseProvider,
      },
    });

    const view = this.toView(created, "admin");
    return warning ? { ...view, warning } : view;
  }

  async update(
    actor: User,
    id: string,
    dto: UpdateAppDto,
  ): Promise<AppDetailMutationResult> {
    const app = await this.requireApp(id);
    const perm = await this.requireAtLeast(actor, app.id, AppPermission.Manager);

    if (dto.slug !== undefined && dto.slug.trim() !== app.slug) {
      throw new BadRequestException({
        error: { code: "SLUG_IMMUTABLE", message: "创建后不可修改 slug" },
      });
    }

    const data: Prisma.AppUpdateInput = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      this.assertName(name);
      data.name = name;
    }
    if (dto.description !== undefined) {
      data.description = this.emptyToNull(dto.description);
    }
    if (dto.iconUrl !== undefined) data.iconUrl = this.emptyToNull(dto.iconUrl);
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.latestReleaseOnly !== undefined) {
      data.latestReleaseOnly = dto.latestReleaseOnly;
    }
    if (dto.syncPollIntervalSec !== undefined) {
      data.syncPollIntervalSec = dto.syncPollIntervalSec;
    }
    if (dto.assetIncludeGlob !== undefined) {
      data.assetIncludeGlob = this.emptyToNull(dto.assetIncludeGlob);
    }
    if (dto.assetExcludeGlob !== undefined) {
      data.assetExcludeGlob = this.emptyToNull(dto.assetExcludeGlob);
    }
    if (dto.releaseProjectId !== undefined) {
      data.releaseProjectId = this.emptyToNull(dto.releaseProjectId);
    }
    if (dto.platformRules !== undefined) {
      data.platformRulesJson =
        dto.platformRules === null ? null : JSON.stringify(dto.platformRules);
    }
    if (dto.storagePrefix !== undefined) {
      const prefix = this.emptyToNull(dto.storagePrefix);
      if (prefix) this.assertStoragePrefix(prefix);
      data.storagePrefix = prefix;
    }

    const nextVisibility = dto.visibility ?? app.visibility;
    if (dto.visibility !== undefined) {
      this.assertVisibility(dto.visibility);
      data.visibility = dto.visibility;
    }

    const mapped = this.mapReleaseAliases(dto);
    const nextProvider = mapped.releaseProvider ?? app.releaseProvider;
    this.assertProvider(nextProvider);

    const nextOwner =
      mapped.releaseOwner !== undefined
        ? this.emptyToNull(mapped.releaseOwner)
        : app.releaseOwner;
    const nextRepo =
      mapped.releaseRepo !== undefined
        ? this.emptyToNull(mapped.releaseRepo)
        : app.releaseRepo;
    const nextBase =
      mapped.releaseBaseUrl !== undefined
        ? this.emptyToNull(mapped.releaseBaseUrl)
        : app.releaseBaseUrl;

    if (mapped.releaseProvider !== undefined) data.releaseProvider = nextProvider;
    if (mapped.releaseOwner !== undefined) data.releaseOwner = nextOwner;
    if (mapped.releaseRepo !== undefined) data.releaseRepo = nextRepo;
    if (mapped.releaseBaseUrl !== undefined) data.releaseBaseUrl = nextBase;

    this.assertReleaseRef(nextProvider, nextOwner, nextRepo);

    let syncWebhook =
      dto.syncWebhookEnabled !== undefined
        ? dto.syncWebhookEnabled
        : app.syncWebhookEnabled;
    let syncPoll =
      dto.syncPollEnabled !== undefined ? dto.syncPollEnabled : app.syncPollEnabled;
    let warning: string | undefined;

    if (nextProvider === ReleaseProvider.None) {
      if (syncWebhook || syncPoll) {
        throw new BadRequestException({
          error: {
            code: "SYNC_REQUIRES_PROVIDER",
            message: "未配置 Release Provider 时不能开启同步",
          },
        });
      }
    } else if (!isReleaseProviderImplemented(nextProvider)) {
      if (syncWebhook || syncPoll) {
        syncWebhook = false;
        syncPoll = false;
        warning = "PROVIDER_NOT_IMPLEMENTED";
      }
    }

    if (syncWebhook !== app.syncWebhookEnabled) data.syncWebhookEnabled = syncWebhook;
    if (syncPoll !== app.syncPollEnabled) data.syncPollEnabled = syncPoll;
    if (dto.syncWebhookEnabled !== undefined) data.syncWebhookEnabled = syncWebhook;
    if (dto.syncPollEnabled !== undefined) data.syncPollEnabled = syncPoll;

    const refChanged =
      nextProvider !== app.releaseProvider ||
      nextOwner !== app.releaseOwner ||
      nextRepo !== app.releaseRepo ||
      (nextBase ?? "") !== (app.releaseBaseUrl ?? "");
    if (nextProvider !== ReleaseProvider.None && refChanged) {
      await this.assertReleaseRefFree(
        nextProvider,
        nextOwner,
        nextRepo,
        nextBase,
        app.id,
      );
    }

    const updated = await this.prisma.app.update({
      where: { id: app.id },
      data,
      select: APP_FIELDS,
    });

    if (dto.storagePrefix !== undefined && updated.storagePrefix) {
      await this.storage.ensurePrefix(updated.storagePrefix);
    }

    if (dto.visibility !== undefined && dto.visibility !== app.visibility) {
      await this.audit.record({
        actorUserId: actor.id,
        action: "app.visibility_change",
        targetType: "app",
        targetId: app.id,
        meta: { from: app.visibility, to: dto.visibility },
      });
    }

    const detail = await this.toDetail(updated, perm);
    return warning ? { ...detail, warning } : detail;
  }

  async archive(
    actor: User,
    id: string,
    purgeFiles: boolean,
  ): Promise<AppDetailView> {
    if (actor.role !== UserRole.Admin) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "仅管理员可归档应用" },
      });
    }
    const app = await this.requireApp(id);
    if (app.status === AppStatus.Archived) {
      return this.toDetail(app, "admin");
    }

    const updated = await this.prisma.app.update({
      where: { id: app.id },
      data: {
        status: AppStatus.Archived,
        syncWebhookEnabled: false,
        syncPollEnabled: false,
      },
      select: APP_FIELDS,
    });

    if (purgeFiles && updated.storagePrefix) {
      await this.localStorage.removePrefix(updated.storagePrefix);
    }

    await this.audit.record({
      actorUserId: actor.id,
      action: "app.archive",
      targetType: "app",
      targetId: app.id,
      meta: { slug: app.slug, purgeFiles },
    });

    return this.toDetail(updated, "admin");
  }

  async unarchive(actor: User, id: string): Promise<AppDetailView> {
    if (actor.role !== UserRole.Admin) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "仅管理员可取消归档" },
      });
    }
    const app = await this.requireApp(id);
    if (app.status === AppStatus.Active) {
      return this.toDetail(app, "admin");
    }
    const updated = await this.prisma.app.update({
      where: { id: app.id },
      data: { status: AppStatus.Active },
      select: APP_FIELDS,
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: "app.unarchive",
      targetType: "app",
      targetId: app.id,
      meta: { slug: app.slug },
    });
    return this.toDetail(updated, "admin");
  }

  async listMembers(actor: User, appId: string) {
    await this.requireApp(appId);
    await this.requireAtLeast(actor, appId, AppPermission.Viewer);
    const rows = await this.prisma.appMember.findMany({
      where: { appId },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: {
            username: true,
            email: true,
            displayName: true,
          },
        },
      },
    });
    return rows.map((row) => ({
      userId: row.userId,
      username: row.user.username,
      email: row.user.email,
      displayName: row.user.displayName,
      permission: row.permission,
      createdAt: row.createdAt,
    }));
  }

  async upsertMember(actor: User, appId: string, dto: UpsertMemberDto) {
    await this.requireApp(appId);
    await this.requireAtLeast(actor, appId, AppPermission.Manager);

    if (
      dto.permission !== AppPermission.Viewer &&
      dto.permission !== AppPermission.Operator &&
      dto.permission !== AppPermission.Manager
    ) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "权限仅允许 viewer、operator、manager" },
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "用户不存在" },
      });
    }
    if (user.status !== UserStatus.Active) {
      throw new BadRequestException({
        error: { code: "USER_INACTIVE", message: "用户未启用" },
      });
    }

    const member = await this.prisma.appMember.upsert({
      where: { appId_userId: { appId, userId: dto.userId } },
      create: {
        appId,
        userId: dto.userId,
        permission: dto.permission,
      },
      update: { permission: dto.permission },
      include: {
        user: {
          select: { username: true, email: true, displayName: true },
        },
      },
    });

    await this.audit.record({
      actorUserId: actor.id,
      action: "app.member_upsert",
      targetType: "app",
      targetId: appId,
      meta: { userId: dto.userId, permission: dto.permission },
    });

    return {
      userId: member.userId,
      username: member.user.username,
      email: member.user.email,
      displayName: member.user.displayName,
      permission: member.permission,
      createdAt: member.createdAt,
    };
  }

  async removeMember(actor: User, appId: string, userId: string) {
    await this.requireApp(appId);
    await this.requireAtLeast(actor, appId, AppPermission.Manager);
    const existing = await this.prisma.appMember.findUnique({
      where: { appId_userId: { appId, userId } },
    });
    if (!existing) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "成员不存在" },
      });
    }
    await this.prisma.appMember.delete({ where: { id: existing.id } });
    await this.audit.record({
      actorUserId: actor.id,
      action: "app.member_remove",
      targetType: "app",
      targetId: appId,
      meta: { userId },
    });
    return { ok: true };
  }

  private async requireApp(id: string): Promise<AppRow> {
    const app = await this.prisma.app.findUnique({
      where: { id },
      select: APP_FIELDS,
    });
    if (!app) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "应用不存在" },
      });
    }
    return app;
  }

  private async requireAtLeast(
    actor: User,
    appId: string,
    min: AppPermission,
  ): Promise<"admin" | AppPermission> {
    if (actor.role === UserRole.Admin) return "admin";
    const member = await this.prisma.appMember.findUnique({
      where: { appId_userId: { appId, userId: actor.id } },
    });
    const perm = member?.permission;
    const have = perm !== undefined ? (RANK[perm] ?? 0) : 0;
    const need = RANK[min] ?? 0;
    if (!perm || have < need) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "无权访问该应用" },
      });
    }
    return perm as AppPermission;
  }

  private toView(app: AppRow, myPermission: "admin" | AppPermission): AppView {
    let platformRules: unknown = null;
    if (app.platformRulesJson) {
      try {
        platformRules = JSON.parse(app.platformRulesJson);
      } catch {
        platformRules = null;
      }
    }
    return {
      id: app.id,
      name: app.name,
      slug: app.slug,
      description: app.description,
      releaseProvider: app.releaseProvider,
      releaseOwner: app.releaseOwner,
      releaseRepo: app.releaseRepo,
      visibility: app.visibility,
      status: app.status,
      sortOrder: app.sortOrder,
      storagePrefix: app.storagePrefix,
      syncWebhookEnabled: app.syncWebhookEnabled,
      syncPollEnabled: app.syncPollEnabled,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      releaseBaseUrl: app.releaseBaseUrl,
      releaseProjectId: app.releaseProjectId,
      syncPollIntervalSec: app.syncPollIntervalSec,
      assetIncludeGlob: app.assetIncludeGlob,
      assetExcludeGlob: app.assetExcludeGlob,
      platformRules,
      latestReleaseOnly: app.latestReleaseOnly,
      iconUrl: app.iconUrl,
      myPermission,
    };
  }

  private async toDetail(app: AppRow, myPermission: "admin" | AppPermission): Promise<AppDetailView> {
    const base = this.config.get<string>("APPDOCK_PUBLIC_BASE_URL")?.replace(/\/$/, "") ?? "";
    const webhookUrl =
      app.releaseProvider === ReleaseProvider.Github
        ? `${base}${API_PREFIX}/hooks/github`
        : null;
    let providerStatus: AppDetailView["providerStatus"];
    if (app.releaseProvider === ReleaseProvider.None) {
      providerStatus = "manual";
    } else if (isReleaseProviderImplemented(app.releaseProvider)) {
      providerStatus = "implemented";
    } else {
      providerStatus = "not_implemented";
    }
    const boundAccessCodes =
      app.visibility === AppVisibility.Password
        ? await this.accessCodes.listBoundForApp(app.id)
        : [];
    return { ...this.toView(app, myPermission), webhookUrl, providerStatus, boundAccessCodes };
  }

  private mapReleaseAliases(dto: {
    releaseProvider?: string;
    releaseOwner?: string | null;
    releaseRepo?: string | null;
    releaseBaseUrl?: string | null;
    githubOwner?: string;
    githubRepo?: string;
  }): {
    releaseProvider?: string;
    releaseOwner?: string | null;
    releaseRepo?: string | null;
    releaseBaseUrl?: string | null;
  } {
    let releaseProvider = dto.releaseProvider;
    let releaseOwner = dto.releaseOwner;
    let releaseRepo = dto.releaseRepo;
    const ownerEmpty = releaseOwner === undefined || releaseOwner === null || releaseOwner === "";
    const repoEmpty = releaseRepo === undefined || releaseRepo === null || releaseRepo === "";
    if (dto.githubOwner && ownerEmpty) {
      releaseOwner = dto.githubOwner;
    }
    if (dto.githubRepo && repoEmpty) {
      releaseRepo = dto.githubRepo;
    }
    if (!releaseProvider && (dto.githubOwner || dto.githubRepo)) {
      releaseProvider = ReleaseProvider.Github;
    }
    return {
      releaseProvider,
      releaseOwner,
      releaseRepo,
      releaseBaseUrl: dto.releaseBaseUrl,
    };
  }

  private assertName(name: string) {
    if (name.length < 1 || name.length > 80) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "名称长度为 1–80" },
      });
    }
  }

  private assertSlug(slug: string) {
    if (slug.length < 2 || slug.length > 64 || !SLUG_RE.test(slug)) {
      throw new BadRequestException({
        error: {
          code: "BAD_REQUEST",
          message: "slug 须为 2–64 位小写字母、数字与连字符",
        },
      });
    }
  }

  private assertVisibility(visibility: string) {
    const ok = (
      [AppVisibility.Public, AppVisibility.Password, AppVisibility.Login] as string[]
    ).includes(visibility);
    if (!ok) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "visibility 仅允许 public、password、login" },
      });
    }
  }

  private assertProvider(provider: string) {
    const ok = (
      [
        ReleaseProvider.None,
        ReleaseProvider.Github,
        ReleaseProvider.Gitee,
        ReleaseProvider.Gitlab,
      ] as string[]
    ).includes(provider);
    if (!ok) {
      throw new BadRequestException({
        error: {
          code: "BAD_REQUEST",
          message: "releaseProvider 仅允许 none、github、gitee、gitlab",
        },
      });
    }
  }

  private assertReleaseRef(
    provider: string,
    owner: string | null,
    repo: string | null,
  ) {
    if (provider !== ReleaseProvider.None && (!owner || !repo)) {
      throw new BadRequestException({
        error: {
          code: "RELEASE_REF_REQUIRED",
          message: "非 none 的 Provider 必须填写 releaseOwner 与 releaseRepo",
        },
      });
    }
  }

  private assertStoragePrefix(prefix: string) {
    const normalized = prefix.replace(/\\/g, "/");
    if (
      !prefix ||
      normalized.split("/").some((seg) => seg === ".." || seg === "") ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(prefix)
    ) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "storagePrefix 非法" },
      });
    }
  }

  private async assertSlugFree(slug: string) {
    const taken = await this.prisma.app.findUnique({ where: { slug } });
    if (taken) {
      throw new ConflictException({
        error: { code: "SLUG_TAKEN", message: "slug 已被占用" },
      });
    }
  }

  private async assertReleaseRefFree(
    provider: string,
    owner: string | null,
    repo: string | null,
    baseUrl: string | null,
    excludeId?: string,
  ) {
    const found = await this.prisma.app.findFirst({
      where: {
        releaseProvider: provider,
        releaseOwner: owner,
        releaseRepo: repo,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (found && (found.releaseBaseUrl ?? "") === (baseUrl ?? "")) {
      throw new ConflictException({
        error: { code: "RELEASE_REF_TAKEN", message: "该 Release 源已被其他应用占用" },
      });
    }
  }

  private parseGithubUrl(raw: string): { owner: string; repo: string } {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new BadRequestException({
        error: { code: "BAD_URL", message: "不是有效的 URL" },
      });
    }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
      throw new BadRequestException({
        error: { code: "BAD_URL", message: "仅支持 https://github.com/owner/repo" },
      });
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new BadRequestException({
        error: { code: "BAD_URL", message: "地址需包含 owner 与 repo，例如 https://github.com/org/app" },
      });
    }
    const owner = decodeURIComponent(parts[0] ?? "");
    const repo = decodeURIComponent(parts[1] ?? "").replace(/\.git$/i, "");
    if (!owner || !repo || owner === "." || owner === ".." || repo === "." || repo === "..") {
      throw new BadRequestException({
        error: { code: "BAD_URL", message: "无法从地址解析 owner / repo" },
      });
    }
    return { owner, repo };
  }

  private async fetchGithubRepo(owner: string, repo: string): Promise<{
    name: string;
    description: string | null;
    iconUrl: string | null;
    private: boolean;
    htmlUrl: string;
  }> {
    const token = this.config.get<string>("APPDOCK_GITHUB_TOKEN")?.trim() ?? "";
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "AppDock",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const encodedOwner = encodeURIComponent(owner);
    const encodedRepo = encodeURIComponent(repo);
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${encodedOwner}/${encodedRepo}`, { headers });
    } catch {
      throw new BadRequestException({
        error: { code: "GITHUB_UNREACHABLE", message: "无法连接 GitHub API" },
      });
    }
    if (res.status === 404) {
      throw new BadRequestException({
        error: { code: "GITHUB_NOT_FOUND", message: "仓库不存在，或为私有仓库且未配置 Token" },
      });
    }
    if (!res.ok) {
      throw new BadRequestException({
        error: { code: "GITHUB_ERROR", message: `GitHub API 返回 ${res.status}` },
      });
    }
    const body = (await res.json()) as {
      name?: string;
      description?: string | null;
      private?: boolean;
      html_url?: string;
      owner?: { avatar_url?: string };
    };
    return {
      name: (body.name || repo).trim(),
      description: body.description?.trim() || null,
      iconUrl: body.owner?.avatar_url?.trim() || null,
      private: Boolean(body.private),
      htmlUrl: body.html_url || `https://github.com/${owner}/${repo}`,
    };
  }

  private suggestSlug(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/g, "");
    return slug.length >= 2 ? slug : "";
  }

  private shortName(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
  }

  private emptyToNull(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
}
