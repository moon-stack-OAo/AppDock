import { Injectable } from "@nestjs/common";
import {
  CanonicalAsset,
  CanonicalRelease,
  ProviderAppRef,
  ProviderError,
  ProviderId,
  ReleaseProviderAdapter,
} from "./release-provider.types";

function notImplemented(id: ProviderId): never {
  throw new ProviderError(
    "PROVIDER_NOT_IMPLEMENTED",
    `${id} 同步尚未实现`,
    501,
  );
}

@Injectable()
export class GiteeReleaseAdapter implements ReleaseProviderAdapter {
  readonly id = "gitee" as const;

  listReleases(_app: ProviderAppRef): Promise<CanonicalRelease[]> {
    notImplemented(this.id);
  }

  getRelease(_app: ProviderAppRef, _tag: string): Promise<CanonicalRelease> {
    notImplemented(this.id);
  }

  downloadAsset(
    _app: ProviderAppRef,
    _asset: CanonicalAsset,
    _destPath: string,
  ): Promise<{ bytes: number }> {
    notImplemented(this.id);
  }
}

@Injectable()
export class GitlabReleaseAdapter implements ReleaseProviderAdapter {
  readonly id = "gitlab" as const;

  listReleases(_app: ProviderAppRef): Promise<CanonicalRelease[]> {
    notImplemented(this.id);
  }

  getRelease(_app: ProviderAppRef, _tag: string): Promise<CanonicalRelease> {
    notImplemented(this.id);
  }

  downloadAsset(
    _app: ProviderAppRef,
    _asset: CanonicalAsset,
    _destPath: string,
  ): Promise<{ bytes: number }> {
    notImplemented(this.id);
  }
}
