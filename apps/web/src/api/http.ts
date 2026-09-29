import { API_PREFIX } from "@appdock/shared";
import {
  clearSession,
  getAccessToken,
  setAccessToken,
} from "@/auth/session";
import type { ApiErrorBody } from "@/types/auth";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: ApiErrorBody;

  constructor(status: number, body?: ApiErrorBody, fallback = "请求失败") {
    const message =
      body?.error?.message ||
      (Array.isArray(body?.message) ? body.message[0] : body?.message) ||
      fallback;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code;
    this.body = body;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  /** 跳过 401 自动 refresh（避免 refresh 自身递归） */
  skipRefresh?: boolean;
  /** 401 时不要清掉登录会话（公开下载页的口令/登录墙） */
  keepSession?: boolean;
  signal?: AbortSignal;
};

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(keepSession = false): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_PREFIX}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        if (!keepSession) clearSession();
        return false;
      }
      const data = (await res.json()) as { accessToken?: string };
      if (!data.accessToken) {
        if (!keepSession) clearSession();
        return false;
      }
      setAccessToken(data.accessToken);
      return true;
    } catch {
      if (!keepSession) clearSession();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, form, auth = true, skipRefresh = false, keepSession = false, signal } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (body !== undefined && form === undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (auth) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(`${API_PREFIX}${path}`, {
    method,
    credentials: "include",
    headers,
    signal,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  if (res.status === 401 && auth && !skipRefresh) {
    const refreshed = await tryRefresh(keepSession);
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let parsed: ApiErrorBody | unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text) as ApiErrorBody;
    } catch {
      parsed = { message: text };
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed as ApiErrorBody);
  }

  return parsed as T;
}
