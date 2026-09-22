import { apiRequest } from "./http";

export type AccessCodeItem = {
  id: string;
  note: string;
  prefix: string;
  status: string;
  storedStatus: string;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  lastUsedAt: string | null;
  appIds: string[];
  apps: { id: string; name: string; slug: string }[];
  createdBy: { id: string; username: string; displayName: string | null } | null;
  createdAt: string;
};

export type AccessCodePage = {
  items: AccessCodeItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AccessCodeWrite = {
  id: string;
  plainCode: string;
  prefix: string;
  item?: AccessCodeItem;
};

export function listAccessCodes(page = 1, pageSize = 50) {
  return apiRequest<AccessCodePage>(`/admin/access-codes?page=${page}&pageSize=${pageSize}`);
}

export function createAccessCode(body: {
  note?: string;
  expiresAt?: string | null;
  maxUses?: number | null;
  appIds: string[];
  customCode?: string | null;
}) {
  return apiRequest<AccessCodeWrite>("/admin/access-codes", { method: "POST", body });
}

export function updateAccessCode(
  id: string,
  body: {
    note?: string;
    expiresAt?: string | null;
    maxUses?: number | null;
    appIds?: string[];
    status?: string;
  },
) {
  return apiRequest<AccessCodeItem>(`/admin/access-codes/${id}`, { method: "PATCH", body });
}

export function rotateAccessCode(id: string) {
  return apiRequest<AccessCodeWrite>(`/admin/access-codes/${id}/rotate`, { method: "POST" });
}

export function revealAccessCode(id: string) {
  return apiRequest<{ plainCode: string }>(`/admin/access-codes/${id}/reveal`, { method: "POST" });
}

export function disableAccessCode(id: string) {
  return apiRequest<AccessCodeItem>(`/admin/access-codes/${id}`, { method: "DELETE" });
}
