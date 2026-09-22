import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import Redis from "ioredis";
import {
  ASSET_DOWNLOAD_QUEUE,
  NOTIFY_QUEUE,
  QUEUE_PREFIX,
  RELEASE_SYNC_QUEUE,
  AssetDownloadPayload,
  NotifyPayload,
  PollTickPayload,
  ReleaseSyncPayload,
} from "./queue.constants";

const POLL_TICK_QUEUE = "poll-tick";
import { redisConnection } from "./queue.connection";

@Injectable()
export class QueueRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(QueueRegistry.name);
  private releaseSync?: Queue<ReleaseSyncPayload>;
  private assetDownload?: Queue<AssetDownloadPayload>;
  private notify?: Queue<NotifyPayload>;
  private pollTick?: Queue<PollTickPayload>;

  constructor(private readonly config: ConfigService) {}

  releaseSyncQueue(): Queue<ReleaseSyncPayload> {
    if (!this.releaseSync) {
      this.releaseSync = new Queue<ReleaseSyncPayload>(RELEASE_SYNC_QUEUE, {
        prefix: QUEUE_PREFIX,
        connection: redisConnection(this.config),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      });
    }
    return this.releaseSync;
  }

  assetDownloadQueue(): Queue<AssetDownloadPayload> {
    if (!this.assetDownload) {
      this.assetDownload = new Queue<AssetDownloadPayload>(ASSET_DOWNLOAD_QUEUE, {
        prefix: QUEUE_PREFIX,
        connection: redisConnection(this.config),
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: 500,
          removeOnFail: 500,
        },
      });
    }
    return this.assetDownload;
  }

  pollTickQueue(): Queue<PollTickPayload> {
    if (!this.pollTick) {
      this.pollTick = new Queue<PollTickPayload>(POLL_TICK_QUEUE, {
        prefix: QUEUE_PREFIX,
        connection: redisConnection(this.config),
        defaultJobOptions: {
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      });
    }
    return this.pollTick;
  }

  notifyQueue(): Queue<NotifyPayload> {
    if (!this.notify) {
      this.notify = new Queue<NotifyPayload>(NOTIFY_QUEUE, {
        prefix: QUEUE_PREFIX,
        connection: redisConnection(this.config),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      });
    }
    return this.notify;
  }

  async jobCounts(): Promise<{
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
  }[]> {
    const queues = [this.releaseSyncQueue(), this.assetDownloadQueue(), this.notifyQueue()];
    return Promise.all(
      queues.map((queue) =>
        queue.getJobCounts("waiting", "active", "failed", "delayed").then((counts) => ({
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        })),
      ),
    );
  }

  async ping(): Promise<void> {
    const url = this.config.get<string>("APPDOCK_REDIS_URL", "redis://127.0.0.1:6379");
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    client.on("error", () => undefined);
    try {
      await client.connect();
      await client.ping();
    } finally {
      client.disconnect();
    }
  }

  async onModuleDestroy() {
    await Promise.all(
      [this.releaseSync, this.assetDownload, this.notify, this.pollTick].map((queue) =>
        queue ? queue.close().catch(() => undefined) : Promise.resolve(),
      ),
    );
  }

  logReady() {
    this.logger.log("queues ready: release-sync, asset-download, notify");
  }
}
