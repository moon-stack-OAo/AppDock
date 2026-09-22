export const ACCESS_SESSION_COOKIE = "access_session";

export type AccessCodeTokenPayload = {
  codeId: string;
  allowedAppIds: string[];
  typ: "access_code";
  aud: "access_code";
};
