import { apiRequest } from "./http";

export type PublicAppCard = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  iconUrl: string | null;
};

export type PublicAsset = {
  id: string;
  name: string;
  platform: string;
  arch: string;
  size: number;
  checksumSha256: string;
  downloadUrl: string;
};

export type PublicVersion = {
  tagName: string;
  name: string | null;
  body: string | null;
  publishedAt: string | null;
  isPrerelease: boolean;
  isLatest: boolean;
  assets: PublicAsset[];
};

export type PublicAppDetail = {
  app: {
    name: string;
    slug: string;
    description: string | null;
    visibility: string;
    iconUrl: string | null;
  };
  latest: PublicVersion | null;
};

export function listPublicApps() {
  return apiRequest<PublicAppCard[]>("/public/apps", { auth: false, skipRefresh: true });
}

export function getPublicApp(slug: string) {
  return apiRequest<PublicAppDetail>(`/public/apps/${encodeURIComponent(slug)}`, {
    auth: true,
    skipRefresh: true,
    keepSession: true,
  });
}

export function listPublicVersions(slug: string, includePrerelease: boolean) {
  const q = includePrerelease ? "?includePrerelease=true" : "";
  return apiRequest<PublicVersion[]>(
    `/public/apps/${encodeURIComponent(slug)}/versions${q}`,
    { auth: true, skipRefresh: true, keepSession: true },
  );
}

export function getPublicVersion(slug: string, tag: string) {
  return apiRequest<PublicVersion>(
    `/public/apps/${encodeURIComponent(slug)}/versions/${encodeURIComponent(tag)}`,
    { auth: true, skipRefresh: true, keepSession: true },
  );
}

export function unlockApp(slug: string, accessCode: string) {
  return apiRequest<{ ok: true; expiresAt: string }>(
    `/public/apps/${encodeURIComponent(slug)}/unlock`,
    { method: "POST", auth: false, skipRefresh: true, body: { accessCode } },
  );
}

export function lockApp(slug: string) {
  return apiRequest<{ ok: true }>(`/public/apps/${encodeURIComponent(slug)}/lock`, {
    method: "POST",
    auth: false,
    skipRefresh: true,
  });
}
