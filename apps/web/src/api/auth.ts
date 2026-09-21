import { apiRequest } from "./http";
import type { AuthUser, LoginResponse } from "@/types/auth";

export function login(loginId: string, password: string) {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    auth: false,
    skipRefresh: true,
    body: { login: loginId, password },
  });
}

export function fetchMe() {
  return apiRequest<AuthUser>("/auth/me");
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiRequest<{ ok: true }>("/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

export function logout() {
  return apiRequest<{ ok: true }>("/auth/logout", {
    method: "POST",
    auth: false,
    skipRefresh: true,
  });
}
