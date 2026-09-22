export type ProviderId = "github" | "gitee" | "gitlab";

export type ProviderAppRef = {
  releaseProvider: string;
  releaseOwner: string | null;
  releaseRepo: string | null;
  releaseBaseUrl: string | null;
  releaseProjectId: string | null;
};

export type CanonicalAsset = {
  name: string;
  size: number;
  downloadUrl: string;
  remoteId: string;
  contentType?: string | null;
};

export type CanonicalRelease = {
  remoteReleaseId: string;
  tagName: string;
  name: string | null;
  body: string | null;
  isPrerelease: boolean;
  publishedAt: Date | null;
  draft: boolean;
  assets: CanonicalAsset[];
};

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ReleaseProviderAdapter {
  readonly id: ProviderId;
  listReleases(app: ProviderAppRef): Promise<CanonicalRelease[]>;
  getRelease(app: ProviderAppRef, tag: string): Promise<CanonicalRelease>;
  downloadAsset(
    app: ProviderAppRef,
    asset: CanonicalAsset,
    destPath: string,
  ): Promise<{ bytes: number }>;
}
