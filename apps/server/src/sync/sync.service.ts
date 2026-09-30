import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { App, User } from "@prisma/client";
import {
  AppPermission,
  QUEUE_ASSET_DOWNLOAD,
  QUEUE_NOTIFY,
  QUEUE_RELEASE_SYNC,
  ReleaseProvider,
  UserRole,
  isReleaseProviderImplemented,
} from "@appdock/shared";
import { Job } from "bullmq";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { matchName } from "../providers/glob-match";
import { GithubReleaseAdapter } from "../providers/github.adapter";
import { CanonicalRelease } from "../providers/release-provider.types";
import { QueueRegistry } from "../queues/queue.registry";
import { ReleaseSyncPayload } from "../queues/queue.constants";

const RANK: Record<string, number> = {
  [AppPermission.Viewer]: 1,
  [AppPermission.Operator]: 2,
  [AppPermission.Manager]: 3,
};

const ACTIVE_STATES = new Set(["waiting", "delayed", "active", "paused", "prioritized", "waiting-children"]);

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queues: QueueRegistry,
    private readonly config: ConfigService,
    private readonly github: GithubReleaseAdapter,
  ) {}

  async enqueueManual(actor: User, appId: string, tagName?: string) {
    const app = await this.requireApp(appId);
    await this.requireAtLeast(actor, app.id, AppPermission.Operator);
    this.assertProvider(app.releaseProvider);
    if (!app.releaseOwner || !app.releaseRepo) {
      throw new BadRequestException({
        error: { code: "RELEASE_REF_REQUIRED", message: "缺少 releaseOwner 或 releaseRepo" },
      });
    }
    return this.enqueue(app, "manual", tagName, undefined, actor.id);
  }

  /**
   * manual / webhook / poll 共用入队。
   * jobId 固定为 app.id。同应用已有队列任务，或 SyncJob 仍为 queued/running
   * （含产物还在下载、主任务已出队）时，直接返回已有 jobId，不新建。
   */
  async enqueue(
    app: App,
    trigger: ReleaseSyncPayload["trigger"],
    tagName?: string,
    extra?: { yank?: boolean },
    actorUserId?: string | null,
  ): Promise<{ jobId: string }> {
    const trimmedTag = tagName?.trim() || undefined;
    try {
      await this.queues.ping();
    } catch (err) {
      this.logger.warn(`queue unavailable: ${(err as Error).message}`);
      throw new ServiceUnavailableException({
        error: { code: "QUEUE_UNAVAILABLE", message: "队列不可用，请稍后重试" },
      });
    }

    const open = await this.latestOpenId(app.id);
    if (open) return { jobId: open };

    const queue = this.queues.releaseSyncQueue();
    const existing = await queue.getJob(app.id);
    if (existing) {
      const state = await existing.getState();
      if (ACTIVE_STATES.has(state)) {
        const jobId = this.payloadJobId(existing) ?? (await this.latestOpenId(app.id));
        if (jobId) return { jobId };
      }
    }

    const yank = extra?.yank === true;
    const syncJob = await this.prisma.syncJob.create({
      data: {
        appId: app.id,
        trigger,
        status: "queued",
        message: yank
          ? `yank ${trimmedTag ?? ""}`.trim()
          : trimmedTag
            ? `tag ${trimmedTag}`
            : null,
      },
    });

    const payload: ReleaseSyncPayload = {
      syncJobId: syncJob.id,
      appId: app.id,
      tagName: trimmedTag,
      trigger,
      ...(yank ? { yank: true } : {}),
    };

    try {
      if (existing) {
        const state = await existing.getState();
        if (!ACTIVE_STATES.has(state)) {
          await existing.remove().catch(() => undefined);
        }
      }
      await queue.add("sync", payload, { jobId: app.id });
    } catch (err) {
      await this.prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          status: "failed",
          message: (err as Error).message,
          finishedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException({
        error: { code: "QUEUE_UNAVAILABLE", message: "入队失败，队列不可用" },
      });
    }

    await this.audit.record({
      actorUserId: actorUserId ?? null,
      action: "app.sync_enqueued",
      targetType: "app",
      targetId: app.id,
      meta: {
        jobId: syncJob.id,
        tagName: trimmedTag ?? null,
        trigger,
        ...(yank ? { yank: true } : {}),
      },
    });

    return { jobId: syncJob.id };
  }

  /**
   * 轮询专用：远程没有比本地更新的内容时返回 true，不入队。
   * 指定 tag、yank、手动同步不走这里。查远程失败时返回 false，交给正式同步处理。
   */
  async isPollUpToDate(app: App): Promise<boolean> {
    if (app.releaseProvider !== "github" || !app.releaseOwner || !app.releaseRepo) return false;
    let releases: CanonicalRelease[];
    try {
      if (app.latestReleaseOnly) {
        const latest = await this.github.latestRelease(app);
        releases = latest && !latest.draft ? [latest] : [];
      } else {
        releases = await this.github.listReleases(app);
      }
    } catch (err) {
      this.logger.warn(`poll freshness ${app.id} skipped: ${(err as Error).message}`);
      return false;
    }
    const visible = releases.filter((release) => !release.draft && release.tagName);
    if (visible.length === 0) return true;

    const local = await this.prisma.version.findMany({
      where: { appId: app.id, tagName: { in: visible.map((release) => release.tagName) } },
      include: { assets: { select: { name: true, remoteAssetId: true, size: true, source: true } } },
    });
    const byTag = new Map(local.map((row) => [row.tagName, row]));
    for (const release of visible) {
      const version = byTag.get(release.tagName);
      if (!version || version.status === "yanked") return false;
      if ((version.remoteReleaseId ?? "") !== release.remoteReleaseId) return false;
      const localPublished = version.publishedAt?.getTime() ?? 0;
      const remotePublished = release.publishedAt?.getTime() ?? 0;
      if (localPublished !== remotePublished) return false;
      for (const asset of release.assets) {
        if (!matchName(asset.name, app.assetIncludeGlob, app.assetExcludeGlob)) continue;
        const existing = version.assets.find((row) => row.name === asset.name);
        if (!existing || existing.source === "manual") continue;
        if (existing.remoteAssetId !== asset.remoteId || existing.size !== asset.size) return false;
      }
    }
    return true;
  }

  /** 同应用是否仍在同步（队列中，或产物下载未收尾）。轮询跳过用，不创建 SyncJob。 */
  async hasActiveQueueJob(appId: string): Promise<boolean> {
    if (await this.latestOpenId(appId)) return true;
    const queue = this.queues.releaseSyncQueue();
    const existing = await queue.getJob(appId);
    if (!existing) return false;
    const state = await existing.getState();
    return ACTIVE_STATES.has(state);
  }

  async listJobs(
    actor: User,
    query: { queue?: string; status?: string; appId?: string; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where = await this.jobWhere(actor, query.appId, query.status);
    const [total, rows] = await Promise.all([
      this.prisma.syncJob.count({ where }),
      this.prisma.syncJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { app: { select: { id: true, name: true, slug: true } } },
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      queue: query.queue ?? "release-sync",
      items: rows.map((row) => this.toListItem(row)),
    };
  }

  /** Redis 挂了返回 redis:false，不抛 500。非 admin 的计数只含自己有权限的应用的 SyncJob。 */
  async queueSummary(actor: User) {
    const names = [QUEUE_RELEASE_SYNC, QUEUE_ASSET_DOWNLOAD, QUEUE_NOTIFY] as const;
    try {
      await this.queues.ping();
      const counts = await this.queues.jobCounts();
      const queues = Object.fromEntries(names.map((name, index) => [name, counts[index]]));
      if (actor.role !== UserRole.Admin) {
        queues[QUEUE_RELEASE_SYNC] = await this.syncJobCounts(actor);
      }
      return { redis: true as const, queues };
    } catch {
      return { redis: false as const, queues: null };
    }
  }

  private async syncJobCounts(actor: User) {
    const members = await this.prisma.appMember.findMany({
      where: { userId: actor.id },
      select: { appId: true },
    });
    const appId = { in: members.map((row) => row.appId) };
    const [waiting, active, failed] = await Promise.all([
      this.prisma.syncJob.count({ where: { appId, status: "queued" } }),
      this.prisma.syncJob.count({ where: { appId, status: "running" } }),
      this.prisma.syncJob.count({ where: { appId, status: "failed" } }),
    ]);
    return { waiting, active, failed, delayed: 0 };
  }

  async getJob(actor: User, jobId: string) {
    const job = await this.prisma.syncJob.findUnique({
      where: { id: jobId },
      include: {
        app: { select: { id: true, name: true, slug: true } },
        logs: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!job) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "任务不存在" },
      });
    }
    await this.requireAtLeast(actor, job.appId, AppPermission.Viewer);
    return {
      ...this.toListItem(job),
      logs: job.logs.map((log) => ({
        id: log.id,
        level: log.level,
        message: log.message,
        createdAt: log.createdAt,
      })),
    };
  }

  async retry(actor: User, jobId: string) {
    const job = await this.prisma.syncJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "任务不存在" },
      });
    }
    await this.requireAtLeast(actor, job.appId, AppPermission.Operator);
    if (job.status !== "failed") {
      throw new BadRequestException({
        error: { code: "JOB_NOT_FAILED", message: "仅失败任务可重试" },
      });
    }
    const app = await this.requireApp(job.appId);
    this.assertProvider(app.releaseProvider);

    try {
      await this.queues.ping();
    } catch {
      throw new ServiceUnavailableException({
        error: { code: "QUEUE_UNAVAILABLE", message: "队列不可用，请稍后重试" },
      });
    }

    const open = await this.latestOpenId(app.id);
    if (open) {
      throw new HttpException(
        {
          error: {
            code: "SYNC_ALREADY_QUEUED",
            message: "该应用已有进行中的同步",
          },
        },
        409,
      );
    }

    const retried = await this.prisma.syncJob.create({
      data: {
        appId: job.appId,
        trigger: job.trigger,
        status: "queued",
        message: `retry of ${job.id}`,
      },
    });
    const queue = this.queues.releaseSyncQueue();
    const existing = await queue.getJob(app.id);
    if (existing) {
      const state = await existing.getState();
      if (ACTIVE_STATES.has(state)) {
        await this.prisma.syncJob.delete({ where: { id: retried.id } }).catch(() => undefined);
        throw new HttpException(
          {
            error: {
              code: "SYNC_ALREADY_QUEUED",
              message: "该应用已有进行中的同步",
            },
          },
          409,
        );
      }
      await existing.remove().catch(() => undefined);
    }
    try {
      await queue.add(
        "sync",
        {
          syncJobId: retried.id,
          appId: app.id,
          trigger: job.trigger as ReleaseSyncPayload["trigger"],
        },
        { jobId: app.id },
      );
    } catch (err) {
      await this.prisma.syncJob.update({
        where: { id: retried.id },
        data: { status: "failed", message: (err as Error).message, finishedAt: new Date() },
      });
      throw new ServiceUnavailableException({
        error: { code: "QUEUE_UNAVAILABLE", message: "入队失败，队列不可用" },
      });
    }
    await this.audit.record({
      actorUserId: actor.id,
      action: "app.sync_enqueued",
      targetType: "app",
      targetId: app.id,
      meta: { jobId: retried.id, retryOf: job.id },
    });
    return { jobId: retried.id };
  }

  private payloadJobId(job: Job<ReleaseSyncPayload>): string | null {
    return job.data?.syncJobId ?? null;
  }

  /** queued：还在主队列；running：主任务执行中，或产物仍在下载未收尾。 */
  private async latestOpenId(appId: string): Promise<string | null> {
    const row = await this.prisma.syncJob.findFirst({
      where: { appId, status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "desc" },
    });
    return row?.id ?? null;
  }

  private async jobWhere(actor: User, appId: string | undefined, status: string | undefined) {
    const statusFilter = status && status !== "all" ? status : undefined;
    if (actor.role === UserRole.Admin) {
      return {
        ...(appId ? { appId } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      };
    }
    const members = await this.prisma.appMember.findMany({
      where: { userId: actor.id },
      select: { appId: true },
    });
    const allowed = members.map((row) => row.appId);
    if (appId && !allowed.includes(appId)) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "无权访问该应用" },
      });
    }
    return {
      appId: appId ? appId : { in: allowed },
      ...(statusFilter ? { status: statusFilter } : {}),
    };
  }

  private toListItem(row: {
    id: string;
    appId: string;
    trigger: string;
    status: string;
    message: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    statsJson: string | null;
    createdAt: Date;
    app?: { id: string; name: string; slug: string };
  }) {
    let stats: unknown = null;
    if (row.statsJson) {
      try {
        stats = JSON.parse(row.statsJson);
      } catch {
        stats = null;
      }
    }
    return {
      id: row.id,
      queue: "release-sync",
      appId: row.appId,
      appName: row.app?.name ?? null,
      appSlug: row.app?.slug ?? null,
      trigger: row.trigger,
      status: row.status,
      message: row.message,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      stats,
      createdAt: row.createdAt,
    };
  }

  private assertProvider(provider: string) {
    if (provider === ReleaseProvider.None) {
      throw new BadRequestException({
        error: { code: "SYNC_REQUIRES_PROVIDER", message: "未配置 Release Provider" },
      });
    }
    if (!isReleaseProviderImplemented(provider)) {
      throw new HttpException(
        {
          error: {
            code: "PROVIDER_NOT_IMPLEMENTED",
            message: "该 Provider 同步尚未实现",
          },
        },
        501,
      );
    }
  }

  private async requireApp(id: string): Promise<App> {
    const app = await this.prisma.app.findUnique({ where: { id } });
    if (!app) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "应用不存在" },
      });
    }
    return app;
  }

  private async requireAtLeast(actor: User, appId: string, min: AppPermission) {
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
}
