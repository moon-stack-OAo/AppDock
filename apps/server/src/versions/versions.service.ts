import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { User } from "@prisma/client";
import {
  AppPermission,
  AppStatus,
  AppVisibility,
  UserRole,
  VersionStatus,
} from "@appdock/shared";
import { createHash } from "crypto";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { AuditService } from "../audit/audit.service";
import { NotifyService } from "../notify/notify.service";
import { AccessCodesService } from "../access-codes/access-codes.service";
import { PrismaService } from "../prisma/prisma.service";
import { STORAGE, Storage } from "../storage/storage.interface";
import { normalizeArch, normalizePlatform } from "./infer-platform";

const RANK: Record<string, number> = {
  [AppPermission.Viewer]: 1,
  [AppPermission.Operator]: 2,
  [AppPermission.Manager]: 3,
};

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

export type IncomingFile = {
  path: string;
  originalName: string;
  size: number;
  mimetype?: string;
};

export type UploadMeta = {
  tagName?: string;
  name?: string;
  body?: string;
  isPrerelease?: boolean;
  overwrite?: boolean;
  platform?: string;
  arch?: string;
  platforms?: string[];
  arches?: string[];
};

type AssetRow = {
  id: string;
  name: string;
  platform: string;
  arch: string;
  contentType: string | null;
  size: number;
  checksumSha256: string;
  downloadCount: number;
  source: string;
  createdAt: Date;
};

@Injectable()
export class VersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly accessCodes: AccessCodesService,
    private readonly notify: NotifyService,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  async list(actor: User, appId: string) {
    await this.requireAtLeast(actor, appId, AppPermission.Viewer);
    const versions = await this.prisma.version.findMany({
      where: { appId },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      include: { assets: { orderBy: { name: "asc" } } },
    });
    return versions.map((version) => this.toView(version));
  }

  async createMeta(
    actor: User,
    appId: string,
    input: { tagName: string; name?: string; body?: string; isPrerelease?: boolean; publishedAt?: string },
  ) {
    await this.requireAtLeast(actor, appId, AppPermission.Manager);
    const tagName = input.tagName.trim();
    await this.assertTagFree(appId, tagName);
    const version = await this.prisma.version.create({
      data: {
        appId,
        tagName,
        name: input.name?.trim() || tagName,
        body: input.body?.trim() || null,
        isPrerelease: Boolean(input.isPrerelease),
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : new Date(),
        source: "manual",
        status: VersionStatus.Active,
        createdByUserId: actor.id,
      },
      include: { assets: true },
    });
    await this.audit.record({
      actorUserId: actor.id,
      action: "version.create",
      targetType: "version",
      targetId: version.id,
      meta: { appId, tagName },
    });
    return this.toView(version);
  }

  async uploadNewVersion(actor: User, appId: string, meta: UploadMeta, files: IncomingFile[]) {
    await this.requireAtLeast(actor, appId, AppPermission.Manager);
    const tagName = (meta.tagName ?? "").trim();
    if (!tagName) {
      await this.cleanup(files);
      throw new ConflictException({
        error: { code: "TAG_REQUIRED", message: "tagName 必填" },
      });
    }
    if (files.length === 0) {
      throw new ConflictException({
        error: { code: "FILE_REQUIRED", message: "至少上传一个文件" },
      });
    }
    const existing = await this.prisma.version.findUnique({
      where: { appId_tagName: { appId, tagName } },
    });
    if (existing) {
      await this.cleanup(files);
      throw new ConflictException({
        error: { code: "TAG_EXISTS", message: "该 tag 已存在，请改用补传" },
      });
    }
    const version = await this.prisma.version.create({
      data: {
        appId,
        tagName,
        name: meta.name?.trim() || tagName,
        body: meta.body?.trim() || null,
        isPrerelease: Boolean(meta.isPrerelease),
        publishedAt: new Date(),
        source: "manual",
        status: VersionStatus.Active,
        createdByUserId: actor.id,
      },
    });
    try {
      const assets = await this.storeFiles(actor, appId, version.id, meta, files);
      await this.markLatest(appId, version.id, Boolean(meta.isPrerelease));
      await this.enqueueUpload(appId, version.id, version.tagName, version.body, assets);
      return this.toView({ ...version, isLatest: !meta.isPrerelease, assets });
    } catch (err) {
      await this.prisma.version.delete({ where: { id: version.id } }).catch(() => undefined);
      throw err;
    }
  }

  async uploadAssets(actor: User, versionId: string, meta: UploadMeta, files: IncomingFile[]) {
    const version = await this.requireVersion(versionId);
    await this.requireAtLeast(actor, version.appId, AppPermission.Manager);
    if (files.length === 0) {
      throw new ConflictException({
        error: { code: "FILE_REQUIRED", message: "至少上传一个文件" },
      });
    }
    const assets = await this.storeFiles(actor, version.appId, version.id, meta, files);
    await this.enqueueUpload(version.appId, version.id, version.tagName, version.body, assets);
    const fresh = await this.prisma.version.findUniqueOrThrow({
      where: { id: version.id },
      include: { assets: { orderBy: { name: "asc" } } },
    });
    return { ...this.toView(fresh), uploaded: assets };
  }

  async yank(actor: User, versionId: string) {
    const version = await this.requireVersion(versionId);
    await this.requireAtLeast(actor, version.appId, AppPermission.Operator);
    if (version.status === VersionStatus.Yanked) {
      return this.toView(version);
    }
    const updated = await this.prisma.version.update({
      where: { id: version.id },
      data: { status: VersionStatus.Yanked, isLatest: false },
      include: { assets: { orderBy: { name: "asc" } } },
    });
    if (version.isLatest) {
      await this.promoteLatest(version.appId);
    }
    await this.audit.record({
      actorUserId: actor.id,
      action: "version.yank",
      targetType: "version",
      targetId: version.id,
      meta: { appId: version.appId, tagName: version.tagName },
    });
    return this.toView(updated);
  }

  async deleteAsset(actor: User, assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { version: true },
    });
    if (!asset) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "产物不存在" },
      });
    }
    await this.requireAtLeast(actor, asset.version.appId, AppPermission.Manager);
    await this.storage.delete(asset.storageKey);
    await this.prisma.asset.delete({ where: { id: asset.id } });
    await this.audit.record({
      actorUserId: actor.id,
      action: "asset.delete",
      targetType: "asset",
      targetId: asset.id,
      meta: { versionId: asset.versionId, name: asset.name },
    });
    return { ok: true };
  }

  async publicList() {
    const apps = await this.prisma.app.findMany({
      where: {
        status: AppStatus.Active,
        visibility: { in: [AppVisibility.Public, AppVisibility.Password, AppVisibility.Login] },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, description: true, visibility: true, iconUrl: true },
    });
    return apps;
  }

  async publicApp(
    slug: string,
    actor: User | null,
    access: { codeId?: string; allowedAppIds: string[] } = { allowedAppIds: [] },
  ) {
    const app = await this.requirePublicApp(slug, actor, access);
    const latest = await this.prisma.version.findFirst({
      where: { appId: app.id, status: VersionStatus.Active, isPrerelease: false },
      orderBy: [{ isLatest: "desc" }, { publishedAt: "desc" }],
      include: { assets: { orderBy: { name: "asc" } } },
    });
    return {
      app: this.publicAppView(app),
      latest: latest ? this.publicVersion(app.slug, latest) : null,
    };
  }

  async publicVersions(
    slug: string,
    actor: User | null,
    includePrerelease: boolean,
    access: { codeId?: string; allowedAppIds: string[] } = { allowedAppIds: [] },
  ) {
    const app = await this.requirePublicApp(slug, actor, access);
    const versions = await this.prisma.version.findMany({
      where: {
        appId: app.id,
        status: VersionStatus.Active,
        ...(includePrerelease ? {} : { isPrerelease: false }),
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      include: { assets: { orderBy: { name: "asc" } } },
    });
    return versions.map((version) => this.publicVersion(app.slug, version));
  }

  async publicVersionByTag(
    slug: string,
    tag: string,
    actor: User | null,
    access: { codeId?: string; allowedAppIds: string[] } = { allowedAppIds: [] },
  ) {
    const app = await this.requirePublicApp(slug, actor, access);
    const version = await this.prisma.version.findUnique({
      where: { appId_tagName: { appId: app.id, tagName: tag } },
      include: { assets: { orderBy: { name: "asc" } } },
    });
    if (!version || version.status !== VersionStatus.Active) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "版本不存在" },
      });
    }
    return this.publicVersion(app.slug, version);
  }

  async checkUpdate(
    slug: string,
    actor: User | null,
    access: { codeId?: string; allowedAppIds: string[] },
    query: { currentVersion: string; platform: string; arch: string },
  ) {
    const app = await this.requirePublicApp(slug, actor, access);
    const versions = await this.prisma.version.findMany({
      where: { appId: app.id, status: VersionStatus.Active, isPrerelease: false },
      include: { assets: true },
    });
    const latest = pickHighestVersion(versions);
    const current = parseSemver(query.currentVersion);
    const latestVer = latest ? parseSemver(latest.tagName) : null;
    if (!latest || !latestVer || compareSemver(latestVer, current) <= 0) {
      return { updateAvailable: false };
    }
    const asset = matchAsset(latest.assets, query.platform, query.arch);
    if (!asset) return { updateAvailable: false };
    return {
      updateAvailable: true,
      tagName: latest.tagName,
      asset: {
        id: asset.id,
        name: asset.name,
        size: asset.size,
        sha256: asset.checksumSha256,
        downloadUrl: `/api/v1/public/apps/${app.slug}/assets/${asset.id}/download`,
      },
    };
  }

  async openDownload(
    slug: string,
    assetId: string,
    actor: User | null,
    access: { codeId?: string; allowedAppIds: string[] } = { allowedAppIds: [] },
  ) {
    const app = await this.requirePublicApp(slug, actor, access);
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { version: true },
    });
    if (!asset || asset.version.appId !== app.id || asset.version.status !== VersionStatus.Active) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "文件不存在" },
      });
    }
    await this.prisma.asset.update({
      where: { id: asset.id },
      data: { downloadCount: { increment: 1 } },
    });
    const stream = await this.storage.openReadStream(asset.storageKey);
    return {
      stream,
      name: asset.name,
      size: asset.size,
      contentType: asset.contentType || "application/octet-stream",
    };
  }

  private async storeFiles(
    actor: User,
    appId: string,
    versionId: string,
    meta: UploadMeta,
    files: IncomingFile[],
  ): Promise<AssetRow[]> {
    const max = this.maxBytes();
    const saved: AssetRow[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (!file) continue;
        if (file.size > max) {
          throw new PayloadTooLargeException({
            error: { code: "FILE_TOO_LARGE", message: `文件超过上限 ${max} 字节` },
          });
        }
        const name = sanitizeFileName(file.originalName);
        const existing = await this.prisma.asset.findUnique({
          where: { versionId_name: { versionId, name } },
        });
        if (existing && !meta.overwrite) {
          throw new ConflictException({
            error: { code: "ASSET_EXISTS", message: `同名文件已存在：${name}` },
          });
        }
        const sha = await sha256File(file.path);
        const storageKey = path.posix.join(appId, versionId, `${existing?.id ?? "new"}-${name}`);
        const rulesJson = await this.platformRulesJson(appId);
        const explicitPlatform = meta.platforms?.[i] ?? meta.platform;
        const explicitArch = meta.arches?.[i] ?? meta.arch;
        const platform = normalizePlatform(explicitPlatform, name, rulesJson);
        const arch = normalizeArch(explicitArch, name, rulesJson);
        if (existing) {
          const key = existing.storageKey;
          await this.storage.put(key, file.path);
          const updated = await this.prisma.asset.update({
            where: { id: existing.id },
            data: {
              platform,
              arch,
              contentType: file.mimetype || null,
              size: file.size,
              checksumSha256: sha,
              uploadedByUserId: actor.id,
            },
          });
          saved.push(updated);
        } else {
          const created = await this.prisma.asset.create({
            data: {
              versionId,
              name,
              platform,
              arch,
              contentType: file.mimetype || null,
              size: file.size,
              checksumSha256: sha,
              storageKey: path.posix.join(appId, versionId, "pending"),
              source: "manual",
              uploadedByUserId: actor.id,
            },
          });
          const key = path.posix.join(appId, versionId, `${created.id}-${name}`);
          await this.storage.put(key, file.path);
          const updated = await this.prisma.asset.update({
            where: { id: created.id },
            data: { storageKey: key },
          });
          saved.push(updated);
        }
      }
    } catch (err) {
      await this.cleanup(files);
      throw err;
    }
    return saved;
  }

  private async enqueueUpload(
    appId: string,
    versionId: string,
    tagName: string,
    changelog: string | null,
    assets: AssetRow[],
  ) {
    await this.notify.enqueue({
      event: "upload.success",
      appId,
      versionId,
      tagName,
      changelog,
      files: assets.map((asset) => ({ assetId: asset.id, name: asset.name })),
    });
  }

  private async markLatest(appId: string, versionId: string, isPrerelease: boolean) {
    if (isPrerelease) return;
    await this.prisma.version.updateMany({
      where: { appId, isLatest: true },
      data: { isLatest: false },
    });
    await this.prisma.version.update({
      where: { id: versionId },
      data: { isLatest: true },
    });
  }

  private async promoteLatest(appId: string) {
    const next = await this.prisma.version.findFirst({
      where: { appId, status: VersionStatus.Active, isPrerelease: false },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });
    if (!next) return;
    await this.prisma.version.update({
      where: { id: next.id },
      data: { isLatest: true },
    });
  }

  private async assertTagFree(appId: string, tagName: string) {
    const existing = await this.prisma.version.findUnique({
      where: { appId_tagName: { appId, tagName } },
    });
    if (existing) {
      throw new ConflictException({
        error: { code: "TAG_EXISTS", message: "该 tag 已存在" },
      });
    }
  }

  private async requireVersion(id: string) {
    const version = await this.prisma.version.findUnique({
      where: { id },
      include: { assets: { orderBy: { name: "asc" } } },
    });
    if (!version) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "版本不存在" },
      });
    }
    return version;
  }

  private async requirePublicApp(
    slug: string,
    actor: User | null,
    access: { codeId?: string; allowedAppIds: string[] } = { allowedAppIds: [] },
  ) {
    const app = await this.prisma.app.findUnique({ where: { slug } });
    if (!app || app.status !== AppStatus.Active) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "应用不存在" },
      });
    }
    if (app.visibility === AppVisibility.Public) return app;
    if (app.visibility === AppVisibility.Password) {
      const ok = await this.accessCodes.grantStillValid(
        access.allowedAppIds,
        app.id,
        access.codeId,
      );
      if (!ok) {
        throw new ForbiddenException({
          error: { code: "PASSWORD_REQUIRED", message: "需要访问口令" },
        });
      }
      return app;
    }
    if (!actor) {
      throw new ForbiddenException({
        error: { code: "LOGIN_REQUIRED", message: "需要登录后下载" },
      });
    }
    return app;
  }

  private async requireAtLeast(actor: User, appId: string, min: AppPermission) {
    const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { id: true } });
    if (!app) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "应用不存在" },
      });
    }
    if (actor.role === UserRole.Admin) return "admin" as const;
    const member = await this.prisma.appMember.findUnique({
      where: { appId_userId: { appId, userId: actor.id } },
    });
    const perm = member?.permission;
    const have = perm !== undefined ? (RANK[perm] ?? 0) : 0;
    if (!perm || have < (RANK[min] ?? 0)) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "无权访问该应用" },
      });
    }
    return perm as AppPermission;
  }

  private maxBytes() {
    const raw = this.config.get<string>("APPDOCK_MAX_ASSET_SIZE_BYTES");
    const parsed = raw ? Number(raw) : DEFAULT_MAX_BYTES;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
  }

  private async platformRulesJson(appId: string): Promise<string | null> {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { platformRulesJson: true },
    });
    return app?.platformRulesJson ?? null;
  }

  private toView(version: {
    id: string;
    appId: string;
    tagName: string;
    name: string | null;
    body: string | null;
    isPrerelease: boolean;
    isLatest: boolean;
    publishedAt: Date | null;
    status: string;
    source: string;
    createdAt: Date;
    assets: AssetRow[];
  }) {
    return {
      id: version.id,
      appId: version.appId,
      tagName: version.tagName,
      name: version.name,
      body: version.body,
      isPrerelease: version.isPrerelease,
      isLatest: version.isLatest,
      publishedAt: version.publishedAt,
      status: version.status,
      source: version.source,
      createdAt: version.createdAt,
      assets: version.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        platform: asset.platform,
        arch: asset.arch,
        contentType: asset.contentType,
        size: asset.size,
        checksumSha256: asset.checksumSha256,
        downloadCount: asset.downloadCount,
        source: asset.source,
      })),
    };
  }

  private publicAppView(app: {
    name: string;
    slug: string;
    description: string | null;
    visibility: string;
    iconUrl: string | null;
  }) {
    return {
      name: app.name,
      slug: app.slug,
      description: app.description,
      visibility: app.visibility,
      iconUrl: app.iconUrl,
    };
  }

  private publicVersion(
    slug: string,
    version: {
      tagName: string;
      name: string | null;
      body: string | null;
      publishedAt: Date | null;
      isPrerelease: boolean;
      isLatest: boolean;
      assets: AssetRow[];
    },
  ) {
    return {
      tagName: version.tagName,
      name: version.name,
      body: version.body,
      publishedAt: version.publishedAt,
      isPrerelease: version.isPrerelease,
      isLatest: version.isLatest,
      assets: version.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        platform: asset.platform,
        arch: asset.arch,
        size: asset.size,
        checksumSha256: asset.checksumSha256,
        downloadUrl: `/api/v1/public/apps/${slug}/assets/${asset.id}/download`,
      })),
    };
  }

  private async cleanup(files: IncomingFile[]) {
    await Promise.all(files.map((file) => fsp.unlink(file.path).catch(() => undefined)));
  }
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-()+ ]+/g, "_").trim();
  return base || "file.bin";
}

type Semver = [number, number, number];

function parseSemver(raw: string): Semver {
  const cleaned = raw.trim().replace(/^v/i, "");
  const parts = cleaned.split(".");
  const nums: Semver = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const n = Number.parseInt(parts[i] ?? "0", 10);
    nums[i] = Number.isFinite(n) ? n : 0;
  }
  return nums;
}

function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function pickHighestVersion<T extends { tagName: string; isLatest: boolean; publishedAt: Date | null }>(
  versions: T[],
): T | null {
  if (versions.length === 0) return null;
  return [...versions].sort((a, b) => {
    const byVer = compareSemver(parseSemver(b.tagName), parseSemver(a.tagName));
    if (byVer !== 0) return byVer;
    if (a.isLatest !== b.isLatest) return a.isLatest ? -1 : 1;
    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  })[0] ?? null;
}

function matchAsset<T extends { platform: string; arch: string }>(
  assets: T[],
  platform: string,
  arch: string,
): T | null {
  const plat = platform.trim().toLowerCase();
  const arc = arch.trim().toLowerCase();
  if (!plat) return null;
  const samePlat = assets.filter((asset) => asset.platform.toLowerCase() === plat);
  if (samePlat.length === 0) return null;
  if (!arc) return samePlat[0] ?? null;
  return (
    samePlat.find((asset) => asset.arch.toLowerCase() === arc) ??
    samePlat.find((asset) => asset.arch === "universal" || asset.arch === "unknown") ??
    null
  );
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
