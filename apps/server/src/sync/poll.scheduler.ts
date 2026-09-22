import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "bullmq";
import { ReleaseProvider, isReleaseProviderImplemented } from "@appdock/shared";
import { PrismaService } from "../prisma/prisma.service";
import {
  POLL_TICK_EVERY_MS,
  POLL_TICK_SCHEDULER_ID,
  PollTickPayload,
  QUEUE_PREFIX,
} from "../queues/queue.constants";
import { redisConnection } from "../queues/queue.connection";
import { QueueRegistry } from "../queues/queue.registry";
import { SyncService } from "./sync.service";

const POLL_TICK_QUEUE = "poll-tick";

@Injectable()
export class PollScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(PollScheduler.name);
  private worker?: Worker<PollTickPayload>;
  private ticking = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly queues: QueueRegistry,
    private readonly sync: SyncService,
  ) {}

  /** 仅 worker 进程调用。每 60s 一个 tick，按应用间隔决定是否入队。 */
  async start() {
    const connection = redisConnection(this.config);
    const queue = this.queues.pollTickQueue();
    await queue.upsertJobScheduler(
      POLL_TICK_SCHEDULER_ID,
      { every: POLL_TICK_EVERY_MS },
      { name: "tick", data: { kind: "poll-tick" } },
    );
    this.worker = new Worker<PollTickPayload>(
      POLL_TICK_QUEUE,
      () => this.tick(),
      { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
    );
    this.worker.on("failed", (_job, err) => {
      this.logger.error(`poll tick failed: ${err.message}`);
    });
    this.worker.on("error", (err) => {
      this.logger.error(`poll tick error: ${err.message}`);
    });
    this.logger.log("poll scheduler started every=60s");
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const apps = await this.prisma.app.findMany({
        where: { syncPollEnabled: true, status: "active" },
      });
      const fallback = this.defaultIntervalSec();
      const now = Date.now();
      for (const app of apps) {
        if (app.releaseProvider === ReleaseProvider.None) continue;
        if (!isReleaseProviderImplemented(app.releaseProvider)) {
          this.logger.warn(
            `poll skip ${app.id}: provider ${app.releaseProvider} 尚未实现`,
          );
          continue;
        }
        if (!app.releaseOwner || !app.releaseRepo) continue;
        const intervalSec = app.syncPollIntervalSec ?? fallback;
        if (!Number.isFinite(intervalSec) || intervalSec <= 0) continue;
        const last = await this.prisma.syncJob.findFirst({
          where: { appId: app.id, trigger: { in: ["poll", "webhook", "manual"] } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (last && now - last.createdAt.getTime() < intervalSec * 1000) continue;
        if (await this.sync.hasActiveQueueJob(app.id)) continue;
        try {
          await this.sync.enqueue(app, "poll");
        } catch (err) {
          this.logger.warn(`poll enqueue ${app.id} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
  }

  private defaultIntervalSec() {
    const raw = Number(this.config.get("APPDOCK_DEFAULT_POLL_INTERVAL_SEC") ?? 300);
    return Number.isFinite(raw) && raw > 0 ? raw : 300;
  }
}
