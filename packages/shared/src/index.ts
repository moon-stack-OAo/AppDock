/** API 全局前缀（不含 host） */
export const API_PREFIX = "/api/v1" as const;

/** 系统角色（非应用内 permission） */
export enum UserRole {
  Admin = "admin",
  User = "user",
}

/** 账号状态 */
export enum UserStatus {
  Active = "active",
  Disabled = "disabled",
}

/** 应用内权限（app_members.permission） */
export enum AppPermission {
  Viewer = "viewer",
  Operator = "operator",
  Manager = "manager",
}

export enum ReleaseProvider {
  None = "none",
  Github = "github",
  Gitee = "gitee",
  Gitlab = "gitlab",
}

export enum AppVisibility {
  Public = "public",
  Password = "password",
  Login = "login",
}

export enum AppStatus {
  Active = "active",
  Archived = "archived",
}

/** 口令落库状态；expired 读时计算，不入库 */
export enum AccessCodeStatus {
  Active = "active",
  Disabled = "disabled",
  Expired = "expired",
}

export enum VersionStatus {
  Active = "active",
  Yanked = "yanked",
}

export enum AssetSource {
  GithubRelease = "github_release",
  Manual = "manual",
}

export enum AssetPlatform {
  Windows = "windows",
  Macos = "macos",
  Linux = "linux",
  Android = "android",
  Ios = "ios",
  Web = "web",
  Unknown = "unknown",
}

/** 一期已实现同步的 Provider；gitee/gitlab 可保存但同步 501 */
export const IMPLEMENTED_RELEASE_PROVIDERS = [ReleaseProvider.Github] as const;

export function isReleaseProviderImplemented(provider: string): boolean {
  return (IMPLEMENTED_RELEASE_PROVIDERS as readonly string[]).includes(provider);
}

export enum SyncTrigger {
  Webhook = "webhook",
  Poll = "poll",
  Manual = "manual",
}

export enum SyncJobStatus {
  Queued = "queued",
  Running = "running",
  Success = "success",
  Failed = "failed",
}

export const QUEUE_RELEASE_SYNC = "release-sync" as const;
export const QUEUE_ASSET_DOWNLOAD = "asset-download" as const;
export const QUEUE_NOTIFY = "notify" as const;

export type ApiHealthResponse = {
  status: "ok" | "degraded";
  service: string;
  db?: string;
  redis?: string;
  /** 已配置且启用为 true；未启用或未配置为 null。健康检查不探测 SMTP 连接。 */
  smtp?: boolean | null;
  timestamp: string;
};
