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

export type ApiHealthResponse = {
  status: "ok" | "degraded";
  service: string;
  db?: string;
  redis?: string;
  timestamp: string;
};
