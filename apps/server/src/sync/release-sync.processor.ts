import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { STORAGE, Storage } from "../storage/storage.interface";
import { resolveAssetMeta } from "../versions/infer-platform";
import { GithubReleaseAdapter } from "../providers/github.adapter";
import { matchName } from "../providers/glob-match";
import { CanonicalAsset, CanonicalRelease, ProviderError } from "../providers/release-provider.types";
import { NotifyService } from "../notify/notify.service";
import { QueueRegistry } from "../queues/queue.registry";
import { AssetDownloadPayload, NotifyFileRef, ReleaseSyncPayload } from "../queues/queue.constants";

type Stats = {
  syncedReleases: number;
  syncedAssets: number;
  skippedAssets: number;
  warnings: number;
  newVersions: number;
  newAssets: number;
  touchedVersionIds: string[];
};

@Injectable()
export class ReleaseSyncProcessor {
  private readonly logger = new Logger(ReleaseSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubReleaseAdapter,
    private readonly queues: QueueRegistry,
    private readonly notify: NotifyService,
    private readonly config: ConfigService,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  async handle(job: Job<ReleaseSyncPayload>): Promise<void> {
    const { syncJobId, appId, tagName, yank } = job.data;
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { status: "running", startedAt: new Date(), message: null },
    });
    const stats: Stats = {
      syncedReleases: 0,
      syncedAssets: 0,
      skippedAssets: 0,
      warnings: 0,
      newVersions: 0,
      newAssets: 0,
      touchedVersionIds: [],
    };
    try {
      const app = await this.prisma.app.findUnique({ where: { id: appId } });
      if (!app) {
        throw new ProviderError("NOT_FOUND", "应用不存在", 404);
      }
      if (yank) {
        await this.yankVersion(syncJobId, appId, tagName);
        await this.finish(syncJobId, "success", stats, null);
        return;
      }
      if (app.releaseProvider !== "github") {
        throw new ProviderError("PROVIDER_NOT_IMPLEMENTED", "该 Provider 同步尚未实现", 501);
      }
      await this.log(syncJobId, "info", `开始同步 ${app.releaseOwner}/${app.releaseRepo}`);
      const releases = await this.loadReleases(app, tagName);
      const visible = releases.filter((release) => !release.draft && release.tagName);
      const pending: AssetDownloadPayload[] = [];
      if (visible.length === 0) {
        await this.log(syncJobId, "info", "没有可同步的 Release（已跳过 draft）");
      }
      for (const release of visible) {
        const versionId = await this.upsertVersion(app.id, release, syncJobId, stats);
        if (!versionId) continue;
        stats.syncedReleases += 1;
        for (const asset of release.assets) {
          if (!matchName(asset.name, app.assetIncludeGlob, app.assetExcludeGlob)) {
            stats.skippedAssets += 1;
            await this.log(syncJobId, "info", `跳过 ${release.tagName}/${asset.name}（glob）`);
            continue;
          }
          const existing = await this.prisma.asset.findUnique({
            where: { versionId_name: { versionId, name: asset.name } },
          });
          if (existing && existing.source === "manual") {
            stats.skippedAssets += 1;
            stats.warnings += 1;
            await this.log(
              syncJobId,
              "warning",
              `跳过 ${release.tagName}/${asset.name}：本地为手动上传，不覆盖`,
            );
            continue;
          }
          if (existing && existing.remoteAssetId === asset.remoteId && existing.size === asset.size) {
            stats.skippedAssets += 1;
            await this.log(syncJobId, "info", `跳过未变化 ${asset.name}`);
            continue;
          }
          pending.push({
            syncJobId,
            appId: app.id,
            versionId,
            expected: 0,
            asset,
          });
        }
        const queuedForRelease = pending.filter((item) => item.versionId === versionId).length;
        if (queuedForRelease > 0) {
          await this.log(syncJobId, "info", `${release.tagName} 待下载 ${queuedForRelease} 个产物`);
        }
      }
      const expected = pending.length;
      if (expected === 0) {
        await this.finish(syncJobId, "success", stats, null);
        return;
      }
      await this.queues.assetDownloadQueue().addBulk(
        pending.map((data) => ({
          name: "download",
          data: { ...data, expected },
          opts: { jobId: `${syncJobId}:${data.versionId}:${data.asset.remoteId}` },
        })),
      );
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: { statsJson: JSON.stringify(stats), message: `下载中 0/${expected}` },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.log(syncJobId, "error", message);
      await this.finish(syncJobId, "failed", stats, message);
      throw err;
    }
  }

  async downloadOne(job: Job<AssetDownloadPayload>): Promise<void> {
    const { syncJobId, appId, versionId, asset, expected } = job.data;
    let saved = false;
    let warned = false;
    try {
      const app = await this.prisma.app.findUnique({ where: { id: appId } });
      if (!app) throw new ProviderError("NOT_FOUND", "应用不存在", 404);
      const max = this.maxBytes();
      if (asset.size > max) {
        warned = true;
        await this.log(syncJobId, "warning", `${asset.name} 超过体积上限，已跳过`);
        return;
      }
      const tmp = path.join(os.tmpdir(), `appdock-${syncJobId}-${sanitize(asset.remoteId)}`);
      try {
        const { bytes } = await this.github.downloadAsset(app, asset, tmp);
        if (asset.size > 0 && bytes !== asset.size) {
          throw new ProviderError(
            "SIZE_MISMATCH",
            `${asset.name} 大小不一致：声明 ${asset.size}，实际 ${bytes}`,
          );
        }
        const sha = await sha256File(tmp);
        const inferred = resolveAssetMeta(asset.name, app.platformRulesJson);
        const existing = await this.prisma.asset.findFirst({
          where: {
            versionId,
            OR: [{ remoteAssetId: asset.remoteId }, { name: asset.name }],
          },
        });
        if (existing?.source === "manual") {
          warned = true;
          await this.log(syncJobId, "warning", `跳过 ${asset.name}：本地为手动上传`);
          return;
        }
        const record = existing
          ? existing
          : await this.prisma.asset.create({
              data: {
                versionId,
                name: asset.name,
                platform: inferred.platform,
                arch: inferred.arch,
                contentType: asset.contentType ?? null,
                size: bytes,
                checksumSha256: sha,
                storageKey: path.posix.join(appId, versionId, "pending"),
                remoteAssetId: asset.remoteId,
                source: "github_release",
              },
            });
        const key = path.posix.join(appId, versionId, `${record.id}-${asset.name}`);
        await this.storage.put(key, tmp);
        await this.prisma.asset.update({
          where: { id: record.id },
          data: {
            name: asset.name,
            platform: inferred.platform,
            arch: inferred.arch,
            contentType: asset.contentType ?? null,
            size: bytes,
            checksumSha256: sha,
            storageKey: key,
            remoteAssetId: asset.remoteId,
            source: "github_release",
          },
        });
        saved = true;
        await this.log(syncJobId, "info", `已保存 ${asset.name}`);
      } finally {
        await fsp.unlink(tmp).catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.log(syncJobId, "warning", message);
      warned = true;
    } finally {
      await this.settleDownload(syncJobId, expected, saved, warned);
    }
  }

  private async settleDownload(syncJobId: string, expected: number, saved: boolean, warned: boolean) {
    const assetDelta = saved ? 1 : 0;
    const skipDelta = saved ? 0 : 1;
    const warnDelta = warned ? 1 : 0;
    await this.prisma.$executeRaw`
      UPDATE sync_jobs
      SET statsJson = json_object(
        'syncedReleases', COALESCE(json_extract(statsJson, '$.syncedReleases'), 0),
        'syncedAssets', COALESCE(json_extract(statsJson, '$.syncedAssets'), 0) + ${assetDelta},
        'skippedAssets', COALESCE(json_extract(statsJson, '$.skippedAssets'), 0) + ${skipDelta},
        'warnings', COALESCE(json_extract(statsJson, '$.warnings'), 0) + ${warnDelta},
        'newVersions', COALESCE(json_extract(statsJson, '$.newVersions'), 0),
        'newAssets', COALESCE(json_extract(statsJson, '$.newAssets'), 0) + ${assetDelta},
        'touchedVersionIds', COALESCE(json_extract(statsJson, '$.touchedVersionIds'), json_array())
      )
      WHERE id = ${syncJobId} AND status = 'running'
    `;
    const current = await this.prisma.syncJob.findUnique({ where: { id: syncJobId } });
    if (!current || current.status !== "running") return;
    const stats = parseStats(current.statsJson);
    const done = stats.syncedAssets + stats.skippedAssets;
    if (done < expected) {
      await this.prisma.syncJob.updateMany({
        where: { id: syncJobId, status: "running" },
        data: { message: `下载中 ${done}/${expected}` },
      });
      return;
    }
    const claimed = await this.prisma.syncJob.updateMany({
      where: { id: syncJobId, status: "running" },
      data: { status: "success" },
    });
    if (claimed.count !== 1) return;
    const failedAll = stats.syncedAssets === 0 && expected > 0;
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: failedAll ? "failed" : "success",
        message: failedAll ? "全部 asset 下载失败" : null,
        finishedAt: new Date(),
        statsJson: JSON.stringify(stats),
      },
    });
    await this.log(
      syncJobId,
      failedAll ? "error" : "info",
      `结束 status=${failedAll ? "failed" : "success"} releases=${stats.syncedReleases} assets=${stats.syncedAssets} skipped=${stats.skippedAssets} warnings=${stats.warnings}`,
    );
    if (failedAll) {
      await this.enqueueFailure(current.appId, syncJobId, "全部 asset 下载失败");
    } else if (stats.newVersions > 0 || stats.newAssets > 0) {
      await this.enqueueSuccess(current.appId, syncJobId, stats.touchedVersionIds);
    }
  }

  /** deleted webhook：只改 status，不删文件、不下载 asset */
  private async yankVersion(syncJobId: string, appId: string, tagName?: string) {
    if (!tagName) {
      await this.log(syncJobId, "warning", "撤回缺少 tagName，已跳过");
      return;
    }
    const version = await this.prisma.version.findUnique({
      where: { appId_tagName: { appId, tagName } },
    });
    if (!version) {
      await this.log(syncJobId, "info", `${tagName} 本地不存在，无需撤回`);
      return;
    }
    if (version.status !== "yanked") {
      await this.prisma.version.update({
        where: { id: version.id },
        data: { status: "yanked", isLatest: false },
      });
    }
    await this.log(syncJobId, "info", `${tagName} 已撤回（保留文件）`);
  }

  private async loadReleases(
    app: {
      releaseProvider: string;
      releaseOwner: string | null;
      releaseRepo: string | null;
      releaseBaseUrl: string | null;
      releaseProjectId: string | null;
      latestReleaseOnly: boolean;
    },
    tagName?: string,
  ): Promise<CanonicalRelease[]> {
    if (tagName) {
      return [await this.github.getRelease(app, tagName)];
    }
    if (app.latestReleaseOnly) {
      const latest = await this.github.latestRelease(app);
      return latest && !latest.draft ? [latest] : [];
    }
    return this.github.listReleases(app);
  }

  private async upsertVersion(
    appId: string,
    release: CanonicalRelease,
    syncJobId: string,
    stats: Stats,
  ): Promise<string | null> {
    const existing = await this.prisma.version.findUnique({
      where: { appId_tagName: { appId, tagName: release.tagName } },
      include: { assets: { select: { source: true } } },
    });
    if (!existing) {
      const created = await this.prisma.version.create({
        data: {
          appId,
          tagName: release.tagName,
          name: release.name,
          body: release.body,
          isPrerelease: release.isPrerelease,
          publishedAt: release.publishedAt,
          status: "active",
          source: "github_release",
          remoteReleaseId: release.remoteReleaseId,
        },
      });
      await this.markLatest(appId, created.id, release.isPrerelease);
      stats.newVersions += 1;
      if (!stats.touchedVersionIds.includes(created.id)) stats.touchedVersionIds.push(created.id);
      return created.id;
    }
    const hasManual = existing.assets.some((asset) => asset.source === "manual");
    const keepSource = existing.source === "manual" || hasManual;
    if (existing.source === "manual" && existing.status === "yanked") {
      stats.warnings += 1;
      await this.log(syncJobId, "warning", `${release.tagName} 为手动撤回版本，保持 yanked`);
    }
    await this.prisma.version.update({
      where: { id: existing.id },
      data: {
        name: existing.source === "github_release" ? release.name : existing.name,
        body: existing.source === "github_release" ? release.body : existing.body,
        isPrerelease: existing.source === "github_release" ? release.isPrerelease : existing.isPrerelease,
        publishedAt: existing.source === "github_release" ? release.publishedAt : existing.publishedAt,
        remoteReleaseId: release.remoteReleaseId,
        source: keepSource ? existing.source : "github_release",
        status: existing.status === "yanked" ? "yanked" : "active",
      },
    });
    if (existing.status !== "yanked") {
      await this.markLatest(appId, existing.id, release.isPrerelease);
    }
    if (!stats.touchedVersionIds.includes(existing.id)) stats.touchedVersionIds.push(existing.id);
    return existing.id;
  }

  private async markLatest(appId: string, _versionId: string, _isPrerelease: boolean) {
    const versions = await this.prisma.version.findMany({
      where: { appId, status: "active", isPrerelease: false },
      select: { id: true, tagName: true, isLatest: true, publishedAt: true },
    });
    const best = versions.reduce<(typeof versions)[number] | null>((winner, row) => {
      if (!winner) return row;
      const byVer = compareSemver(parseSemver(row.tagName), parseSemver(winner.tagName));
      if (byVer !== 0) return byVer > 0 ? row : winner;
      return (row.publishedAt?.getTime() ?? 0) >= (winner.publishedAt?.getTime() ?? 0) ? row : winner;
    }, null);
    await this.prisma.version.updateMany({
      where: { appId, isLatest: true, ...(best ? { id: { not: best.id } } : {}) },
      data: { isLatest: false },
    });
    if (best && !best.isLatest) {
      await this.prisma.version.update({
        where: { id: best.id },
        data: { isLatest: true },
      });
    }
  }

  private async finish(syncJobId: string, status: "success" | "failed", stats: Stats, message: string | null) {
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status,
        message,
        finishedAt: new Date(),
        statsJson: JSON.stringify(stats),
      },
    });
    await this.log(
      syncJobId,
      status === "success" ? "info" : "error",
      `结束 status=${status} releases=${stats.syncedReleases} assets=${stats.syncedAssets} skipped=${stats.skippedAssets} warnings=${stats.warnings}`,
    );
    if (status === "failed") {
      const job = await this.prisma.syncJob.findUnique({ where: { id: syncJobId }, select: { appId: true } });
      if (job) await this.enqueueFailure(job.appId, syncJobId, message);
    } else if (stats.newVersions > 0 || stats.newAssets > 0) {
      const job = await this.prisma.syncJob.findUnique({ where: { id: syncJobId }, select: { appId: true } });
      if (job) await this.enqueueSuccess(job.appId, syncJobId, stats.touchedVersionIds);
    }
  }

  private async enqueueSuccess(appId: string, syncJobId: string, versionIds: string[]) {
    const versions = versionIds.length
      ? await this.prisma.version.findMany({
          where: { id: { in: versionIds } },
          include: { assets: { orderBy: { name: "asc" } } },
          orderBy: { publishedAt: "desc" },
        })
      : [];
    const files: NotifyFileRef[] = versions.flatMap((version) =>
      version.assets.map((asset) => ({ assetId: asset.id, name: asset.name })),
    );
    const tags = versions.map((version) => version.tagName).filter(Boolean);
    await this.notify.enqueue({
      event: "sync.success",
      appId,
      syncJobId,
      versionId: versions[0]?.id,
      tagName: tags.join(", ") || undefined,
      changelog: versions[0]?.body ?? null,
      files,
    });
  }

  private async enqueueFailure(appId: string, syncJobId: string, error: string | null) {
    await this.notify.enqueue({
      event: "sync.failure",
      appId,
      syncJobId,
      error,
    });
  }

  private async log(jobId: string, level: string, message: string) {
    await this.prisma.syncLog.create({ data: { jobId, level, message } });
    if (level === "error") this.logger.error(message);
    else if (level === "warning") this.logger.warn(message);
  }

  private maxBytes() {
    const raw = this.config.get<string>("APPDOCK_MAX_ASSET_SIZE_BYTES");
    const parsed = raw ? Number(raw) : 1024 * 1024 * 1024;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024 * 1024;
  }
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

function parseStats(raw: string | null): Stats {
  const empty: Stats = {
    syncedReleases: 0,
    syncedAssets: 0,
    skippedAssets: 0,
    warnings: 0,
    newVersions: 0,
    newAssets: 0,
    touchedVersionIds: [],
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<Stats>;
    return {
      syncedReleases: parsed.syncedReleases ?? 0,
      syncedAssets: parsed.syncedAssets ?? 0,
      skippedAssets: parsed.skippedAssets ?? 0,
      warnings: parsed.warnings ?? 0,
      newVersions: parsed.newVersions ?? 0,
      newAssets: parsed.newAssets ?? 0,
      touchedVersionIds: Array.isArray(parsed.touchedVersionIds)
        ? parsed.touchedVersionIds.filter((id) => typeof id === "string")
        : [],
    };
  } catch {
    return empty;
  }
}

type Semver = [number, number, number];

function parseSemver(raw: string): Semver {
  const parts = raw.trim().replace(/^v/i, "").split(".");
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

function sanitize(value: string): string {
  return value.replace(/[^\w.-]+/g, "_").slice(0, 40);
}
