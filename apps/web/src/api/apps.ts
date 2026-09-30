import { apiRequest } from "./http";

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
  createdAt: string;
  updatedAt: string;
  myPermission: string;
  warning?: string;
};

export type BoundAccessCode = {
  id: string;
  note: string;
  prefix: string;
  status: string;
  expiresAt: string | null;
};

export type AppDetail = AppView & {
  webhookUrl: string | null;
  providerStatus: "manual" | "implemented" | "not_implemented";
  boundAccessCodes?: BoundAccessCode[];
};

export type AppFormBody = {
  name?: string;
  slug?: string;
  description?: string | null;
  visibility?: string;
  releaseProvider?: string;
  releaseOwner?: string | null;
  releaseRepo?: string | null;
  releaseBaseUrl?: string | null;
  syncWebhookEnabled?: boolean;
  syncPollEnabled?: boolean;
  assetIncludeGlob?: string | null;
  sortOrder?: number;
  platformRules?: unknown[] | null;
};

export type AppMember = {
  userId: string;
  username: string;
  email: string;
  displayName: string | null;
  permission: string;
  createdAt?: string;
};

export type VersionAsset = {
  id: string;
  name: string;
  platform: string;
  arch: string;
  size: number;
  checksumSha256: string;
  downloadCount: number;
  source: string;
};

export type AppVersion = {
  id: string;
  appId: string;
  tagName: string;
  name: string | null;
  body: string | null;
  isPrerelease: boolean;
  isLatest: boolean;
  publishedAt: string | null;
  status: string;
  source: string;
  assets: VersionAsset[];
};

export function listVersions(appId: string) {
  return apiRequest<AppVersion[]>(`/admin/apps/${appId}/versions`);
}

export function uploadVersion(appId: string, form: FormData) {
  return apiRequest<AppVersion>(`/admin/apps/${appId}/versions/upload`, {
    method: "POST",
    form,
  });
}

export function uploadAssets(versionId: string, form: FormData) {
  return apiRequest<AppVersion>(`/admin/versions/${versionId}/assets/upload`, {
    method: "POST",
    form,
  });
}

/** 单片 50MB，避开服务器 100MB 上传限制。 */
export const UPLOAD_CHUNK_SIZE = 50 * 1024 * 1024;

export type ChunkInit = {
  uploadId: string;
  chunkSize: number;
  fileSize: number;
  totalChunks: number;
  fileName: string;
};

export type ChunkedFile = {
  file: File;
  platform: string;
  arch: string;
};

export type ChunkedUploadInput = {
  appId?: string;
  versionId?: string;
  tagName?: string;
  name?: string;
  body?: string;
  isPrerelease?: boolean;
  files: ChunkedFile[];
  signal?: AbortSignal;
  /** 传输阶段 0–0.9；合并阶段保持 0.9，直到 complete 返回。 */
  onProgress?: (ratio: number) => void;
  onPhase?: (phase: "upload" | "merge") => void;
};

export async function uploadFilesChunked(input: ChunkedUploadInput): Promise<AppVersion> {
  if (input.files.length === 0) {
    throw new Error("至少选择一个文件");
  }
  const totalBytes = input.files.reduce((sum, item) => sum + item.file.size, 0) || 1;
  const uploadCap = 0.9;
  let sent = 0;
  let last: AppVersion | null = null;
  input.onPhase?.("upload");
  for (let index = 0; index < input.files.length; index += 1) {
    const item = input.files[index];
    if (!item) continue;
    last = await uploadOneChunked(
      input,
      item,
      (delta) => {
        sent += delta;
        input.onProgress?.(Math.min(uploadCap, (sent / totalBytes) * uploadCap));
      },
      () => {
        input.onPhase?.("merge");
        input.onProgress?.(Math.min(uploadCap, (sent / totalBytes) * uploadCap));
      },
    );
    if (index < input.files.length - 1) input.onPhase?.("upload");
  }
  if (!last) throw new Error("上传失败");
  return last;
}

async function uploadOneChunked(
  input: ChunkedUploadInput,
  item: ChunkedFile,
  onBytes: (delta: number) => void,
  onMerge: () => void,
): Promise<AppVersion> {
  const meta = {
    tagName: input.tagName ?? "",
    name: input.name ?? "",
    body: input.body ?? "",
    isPrerelease: String(Boolean(input.isPrerelease)),
    overwrite: "true",
    platforms: JSON.stringify([item.platform === "auto" ? "" : item.platform]),
    arches: JSON.stringify([item.arch === "auto" ? "" : item.arch]),
    fileName: item.file.name,
    fileSize: String(item.file.size),
    contentType: item.file.type || "application/octet-stream",
  };
  const initPath = input.versionId
    ? `/admin/versions/${input.versionId}/assets/upload/init`
    : `/admin/apps/${input.appId}/versions/upload/init`;
  const session = await apiRequest<ChunkInit>(initPath, { method: "POST", body: meta, signal: input.signal });
  const chunkSize = session.chunkSize || UPLOAD_CHUNK_SIZE;
  try {
    for (let index = 0; index < session.totalChunks; index += 1) {
      const start = index * chunkSize;
      const blob = item.file.slice(start, Math.min(start + chunkSize, item.file.size));
      const form = new FormData();
      form.set("index", String(index));
      form.set("chunk", blob, "chunk.bin");
      await apiRequest(`/admin/uploads/${session.uploadId}/chunks`, {
        method: "POST",
        form,
        signal: input.signal,
      });
      onBytes(blob.size);
    }
    onMerge();
    const version = await apiRequest<AppVersion>(`/admin/uploads/${session.uploadId}/complete`, {
      method: "POST",
      signal: input.signal,
    });
    return version;
  } catch (err) {
    await apiRequest(`/admin/uploads/${session.uploadId}`, { method: "DELETE" }).catch(() => undefined);
    throw err;
  }
}

export function yankVersion(versionId: string) {
  return apiRequest<AppVersion>(`/admin/versions/${versionId}/yank`, { method: "POST" });
}

export function deleteAsset(assetId: string) {
  return apiRequest<{ ok: boolean }>(`/admin/assets/${assetId}`, { method: "DELETE" });
}

export function listApps() {
  return apiRequest<AppView[]>("/admin/apps");
}

export function getApp(id: string) {
  return apiRequest<AppDetail>(`/admin/apps/${id}`);
}

export type ReleasePreview = {
  releaseProvider: string;
  releaseOwner: string;
  releaseRepo: string;
  name: string;
  slug: string;
  description: string | null;
  iconUrl: string | null;
  private: boolean;
  htmlUrl: string;
};

export function previewRelease(url: string) {
  return apiRequest<ReleasePreview>("/admin/apps/preview-release", {
    method: "POST",
    body: { url },
  });
}

export function createApp(body: AppFormBody) {
  return apiRequest<AppView>("/admin/apps", { method: "POST", body });
}

export function updateApp(id: string, body: AppFormBody) {
  return apiRequest<AppDetail>(`/admin/apps/${id}`, { method: "PATCH", body });
}

export function archiveApp(id: string) {
  return apiRequest<AppDetail>(`/admin/apps/${id}`, { method: "DELETE" });
}

export function unarchiveApp(id: string) {
  return apiRequest<AppDetail>(`/admin/apps/${id}/unarchive`, { method: "POST" });
}

export function listMembers(id: string) {
  return apiRequest<AppMember[]>(`/admin/apps/${id}/members`);
}

export function upsertMember(id: string, body: { userId: string; permission: string }) {
  return apiRequest<AppMember>(`/admin/apps/${id}/members`, { method: "PUT", body });
}

export function removeMember(id: string, userId: string) {
  return apiRequest<{ ok: true }>(`/admin/apps/${id}/members/${userId}`, {
    method: "DELETE",
  });
}
