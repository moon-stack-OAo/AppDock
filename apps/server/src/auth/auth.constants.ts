import { API_PREFIX } from "@appdock/shared";

export const REFRESH_COOKIE_NAME = "refresh_token";
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

export const IS_PUBLIC_KEY = "isPublic";
export const ALLOW_MUST_CHANGE_PASSWORD_KEY = "allowMustChangePassword";
export const ROLES_KEY = "roles";

export type AccessTokenPayload = {
  sub: string;
  role: string;
  typ: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  jti: string;
  typ: "refresh";
};
