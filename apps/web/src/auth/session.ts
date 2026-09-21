import { reactive, readonly } from "vue";
import type { AuthUser } from "@/types/auth";

const TOKEN_KEY = "appdock.accessToken";
const USER_KEY = "appdock.user";

type SessionState = {
  accessToken: string | null;
  user: AuthUser | null;
  bootstrapped: boolean;
};

const state = reactive<SessionState>({
  accessToken: null,
  user: null,
  bootstrapped: false,
});

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function readStoredUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function persist() {
  try {
    if (state.accessToken) {
      sessionStorage.setItem(TOKEN_KEY, state.accessToken);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
    if (state.user) {
      sessionStorage.setItem(USER_KEY, JSON.stringify(state.user));
    } else {
      sessionStorage.removeItem(USER_KEY);
    }
  } catch {
    /* sessionStorage 不可用时仅保留内存 */
  }
}

export function bootstrapSession() {
  if (state.bootstrapped) return;
  state.accessToken = readStoredToken();
  state.user = readStoredUser();
  state.bootstrapped = true;
}

export function setSession(accessToken: string, user: AuthUser) {
  state.accessToken = accessToken;
  state.user = user;
  persist();
}

export function setAccessToken(accessToken: string) {
  state.accessToken = accessToken;
  persist();
}

export function setUser(user: AuthUser) {
  state.user = user;
  persist();
}

export function clearSession() {
  state.accessToken = null;
  state.user = null;
  persist();
}

export function getAccessToken(): string | null {
  return state.accessToken;
}

export const session = readonly(state);
