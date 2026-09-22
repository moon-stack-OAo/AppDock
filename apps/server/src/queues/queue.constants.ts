export const QUEUE_PREFIX = "appdock";

export const RELEASE_SYNC_QUEUE = "release-sync";
export const ASSET_DOWNLOAD_QUEUE = "asset-download";
export const NOTIFY_QUEUE = "notify";

export type ReleaseSyncPayload = {
  syncJobId: string;
  appId: string;
  tagName?: string;
  trigger: "webhook" | "poll" | "manual";
  /** webhook action=deleted：只撤回对应 tag，不下载产物 */
  yank?: boolean;
};

/** Worker 侧轮询调度器，每 60s 扫一次到期应用 */
export const POLL_TICK_SCHEDULER_ID = "poll-tick";
export const POLL_TICK_EVERY_MS = 60_000;

export type PollTickPayload = {
  kind: "poll-tick";
};

export type AssetDownloadPayload = {
  syncJobId: string;
  appId: string;
  versionId: string;
  /** 本轮投递的下载总数，最后一个完成的任务负责收尾 SyncJob */
  expected: number;
  asset: {
    name: string;
    size: number;
    downloadUrl: string;
    remoteId: string;
    contentType?: string | null;
  };
};

export type NotifyEvent = "sync.success" | "sync.failure" | "upload.success";

/** 入队时只放可序列化摘要，Worker 再查库拼邮件。 */
export type NotifyFileRef = {
  assetId: string;
  name: string;
};

export type NotifyPayload = {
  event: NotifyEvent;
  appId: string;
  syncJobId?: string;
  versionId?: string;
  tagName?: string;
  changelog?: string | null;
  error?: string | null;
  files?: NotifyFileRef[];
};
