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
