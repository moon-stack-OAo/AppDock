import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SyncService } from "../sync/sync.service";

type GithubReleaseHook = {
  action?: string;
  release?: { tag_name?: string; draft?: boolean };
  repository?: { full_name?: string };
};

const ENQUEUE_ACTIONS = new Set(["published", "edited", "released", "deleted"]);

@Injectable()
export class HooksService {
  private readonly logger = new Logger(HooksService.name);

  constructor(
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
  ) {}

  async handleGithub(event: string | undefined, body: unknown) {
    if (event !== "release") {
      return { ignored: true };
    }
    const payload = (body ?? {}) as GithubReleaseHook;
    const action = payload.action ?? "";
    if (!ENQUEUE_ACTIONS.has(action)) {
      return { ignored: true };
    }
    if (payload.release?.draft === true) {
      return { ignored: true };
    }

    const fullName = payload.repository?.full_name?.trim();
    const apps = fullName ? await this.matchGithubApps(fullName) : [];
    if (apps.length === 0) {
      return { ignored: true };
    }

    const tagName = payload.release?.tag_name?.trim() || undefined;
    const yank = action === "deleted";
    const jobs: { appId: string; jobId: string }[] = [];
    for (const app of apps) {
      const queued = await this.sync.enqueue(app, "webhook", tagName, yank ? { yank: true } : undefined);
      jobs.push({ appId: app.id, jobId: queued.jobId });
    }
    this.logger.log(`github webhook ${action} ${fullName} enqueued=${jobs.length}`);
    return { ignored: false, jobs };
  }

  private async matchGithubApps(fullName: string) {
    const slash = fullName.indexOf("/");
    if (slash <= 0 || slash === fullName.length - 1) return [];
    const owner = fullName.slice(0, slash);
    const repo = fullName.slice(slash + 1);
    // SQLite 默认 NOCASE，equals 即忽略大小写
    return this.prisma.app.findMany({
      where: {
        releaseProvider: "github",
        status: "active",
        syncWebhookEnabled: true,
        releaseOwner: owner,
        releaseRepo: repo,
      },
    });
  }
}
