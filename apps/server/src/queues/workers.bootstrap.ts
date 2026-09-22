import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "bullmq";
import { NotifyService } from "../notify/notify.service";
import { PollScheduler } from "../sync/poll.scheduler";
import { ReleaseSyncProcessor } from "../sync/release-sync.processor";
import {
  ASSET_DOWNLOAD_QUEUE,
  AssetDownloadPayload,
  NOTIFY_QUEUE,
  NotifyPayload,
  QUEUE_PREFIX,
  RELEASE_SYNC_QUEUE,
  ReleaseSyncPayload,
} from "./queue.constants";
import { redisConnection } from "./queue.connection";

@Injectable()
export class WorkersBootstrap implements OnModuleDestroy {
  private readonly logger = new Logger(WorkersBootstrap.name);
  private workers: Worker[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly processor: ReleaseSyncProcessor,
    private readonly poll: PollScheduler,
    private readonly notify: NotifyService,
  ) {}

  async start() {
    const connection = redisConnection(this.config);
    const downloadConcurrency = Number(this.config.get("APPDOCK_QUEUE_DOWNLOAD_CONCURRENCY") ?? 2) || 2;

    const release = new Worker<ReleaseSyncPayload>(
      RELEASE_SYNC_QUEUE,
      (job) => this.processor.handle(job),
      { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
    );
    const download = new Worker<AssetDownloadPayload>(
      ASSET_DOWNLOAD_QUEUE,
      (job) => this.processor.downloadOne(job),
      { connection, prefix: QUEUE_PREFIX, concurrency: Math.min(4, Math.max(1, downloadConcurrency)) },
    );
    const notify = new Worker<NotifyPayload>(
      NOTIFY_QUEUE,
      (job) => this.notify.handle(job.data),
      { connection, prefix: QUEUE_PREFIX, concurrency: 2 },
    );

    for (const worker of [release, download, notify]) {
      worker.on("failed", (job, err) => {
        this.logger.error(`${worker.name} job ${job?.id} failed: ${err.message}`);
      });
      worker.on("error", (err) => {
        this.logger.error(`${worker.name} error: ${err.message}`);
      });
    }
    this.workers = [release, download, notify];
    await this.poll.start();
    this.logger.log(
      `workers started concurrency release-sync=1 asset-download=${download.opts.concurrency} notify=2`,
    );
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close().catch(() => undefined)));
  }
}
