import { apiRequest } from "./http";

export type SyncJobStats = {
  syncedReleases?: number;
  syncedAssets?: number;
  skippedAssets?: number;
  warnings?: number;
};

export type SyncJobItem = {
  id: string;
  queue: string;
  appId: string;
  appName: string | null;
  appSlug: string | null;
  trigger: string;
  status: string;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  stats: SyncJobStats | null;
  createdAt: string;
};

export type SyncLogItem = {
  id: string;
  level: string;
  message: string;
  createdAt: string;
};

export type SyncJobDetail = SyncJobItem & { logs: SyncLogItem[] };

export type SyncJobPage = {
  page: number;
  pageSize: number;
  total: number;
  queue: string;
  items: SyncJobItem[];
};

export function syncApp(appId: string, tagName?: string) {
  return apiRequest<{ jobId: string }>(`/admin/apps/${appId}/sync`, {
    method: "POST",
    body: tagName ? { tagName } : {},
  });
}

export type QueueCounts = {
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
};

export type QueueSummary = {
  redis: boolean;
  queues: Record<string, QueueCounts> | null;
};

export function queueSummary() {
  return apiRequest<QueueSummary>("/admin/queue/summary");
}

export function listJobs(query: {
  queue?: string;
  status?: string;
  appId?: string;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();
  if (query.queue) params.set("queue", query.queue);
  if (query.status) params.set("status", query.status);
  if (query.appId) params.set("appId", query.appId);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const qs = params.toString();
  return apiRequest<SyncJobPage>(`/admin/queue/jobs${qs ? `?${qs}` : ""}`);
}

export function getJob(jobId: string) {
  return apiRequest<SyncJobDetail>(`/admin/queue/jobs/${jobId}`);
}

export function retryJob(jobId: string) {
  return apiRequest<{ jobId: string }>(`/admin/queue/jobs/${jobId}/retry`, {
    method: "POST",
  });
}
