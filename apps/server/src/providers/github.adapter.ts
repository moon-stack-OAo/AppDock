import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fsp from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import {
  CanonicalAsset,
  CanonicalRelease,
  ProviderAppRef,
  ProviderError,
  ReleaseProviderAdapter,
} from "./release-provider.types";

type GithubAsset = {
  id?: number;
  name?: string;
  size?: number;
  browser_download_url?: string;
  url?: string;
  content_type?: string | null;
};

type GithubRelease = {
  id?: number;
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: GithubAsset[];
};

const API = "https://api.github.com";

@Injectable()
export class GithubReleaseAdapter implements ReleaseProviderAdapter {
  readonly id = "github" as const;

  constructor(private readonly config: ConfigService) {}

  async listReleases(app: ProviderAppRef): Promise<CanonicalRelease[]> {
    const { owner, repo } = this.requireRef(app);
    const all: CanonicalRelease[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const rows = await this.requestJson<GithubRelease[]>(
        `/repos/${owner}/${repo}/releases?per_page=100&page=${page}`,
      );
      if (!Array.isArray(rows) || rows.length === 0) break;
      all.push(...rows.map((row) => this.mapToCanonical(row)));
      if (rows.length < 100) break;
    }
    return all;
  }

  async getRelease(app: ProviderAppRef, tag: string): Promise<CanonicalRelease> {
    const { owner, repo } = this.requireRef(app);
    const encoded = encodeURIComponent(tag);
    const row = await this.requestJson<GithubRelease>(
      `/repos/${owner}/${repo}/releases/tags/${encoded}`,
    );
    return this.mapToCanonical(row);
  }

  async latestRelease(app: ProviderAppRef): Promise<CanonicalRelease | null> {
    const { owner, repo } = this.requireRef(app);
    try {
      const row = await this.requestJson<GithubRelease>(
        `/repos/${owner}/${repo}/releases/latest`,
      );
      return this.mapToCanonical(row);
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) return null;
      throw err;
    }
  }

  async downloadAsset(
    _app: ProviderAppRef,
    asset: CanonicalAsset,
    destPath: string,
  ): Promise<{ bytes: number }> {
    const token = this.token();
    const headers: Record<string, string> = {
      Accept: "application/octet-stream",
      "User-Agent": "AppDock",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(asset.downloadUrl, { headers, redirect: "follow" });
    if (!res.ok || !res.body) {
      throw new ProviderError(
        this.httpCode(res.status),
        `下载 ${asset.name} 失败（HTTP ${res.status}）`,
        res.status,
      );
    }
    const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(destPath));
    const stat = await fsp.stat(destPath);
    return { bytes: stat.size };
  }

  mapToCanonical(release: GithubRelease): CanonicalRelease {
    const assets: CanonicalAsset[] = (release.assets ?? [])
      .filter((asset) => asset.name && (asset.browser_download_url || asset.url))
      .map((asset) => ({
        name: asset.name as string,
        size: Number(asset.size ?? 0),
        downloadUrl: (asset.url || asset.browser_download_url) as string,
        remoteId: String(asset.id ?? asset.name),
        contentType: asset.content_type ?? null,
      }));
    return {
      remoteReleaseId: String(release.id ?? release.tag_name ?? ""),
      tagName: release.tag_name ?? "",
      name: release.name ?? null,
      body: release.body ?? null,
      isPrerelease: Boolean(release.prerelease),
      publishedAt: release.published_at ? new Date(release.published_at) : null,
      draft: Boolean(release.draft),
      assets,
    };
  }

  private async requestJson<T>(path: string): Promise<T> {
    const token = this.token();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "AppDock",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        this.httpCode(res.status),
        `GitHub API ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  }

  private requireRef(app: ProviderAppRef): { owner: string; repo: string } {
    const owner = app.releaseOwner?.trim();
    const repo = app.releaseRepo?.trim();
    if (!owner || !repo) {
      throw new ProviderError("RELEASE_REF_REQUIRED", "缺少 releaseOwner 或 releaseRepo", 400);
    }
    return { owner, repo };
  }

  private token(): string {
    return this.config.get<string>("APPDOCK_GITHUB_TOKEN")?.trim() ?? "";
  }

  private httpCode(status: number): string {
    if (status === 401) return "GITHUB_UNAUTHORIZED";
    if (status === 403) return "GITHUB_FORBIDDEN";
    if (status === 404) return "GITHUB_NOT_FOUND";
    return "GITHUB_ERROR";
  }
}
