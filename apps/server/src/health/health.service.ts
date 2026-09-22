import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiHealthResponse } from "@appdock/shared";
import Redis from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  async check(): Promise<ApiHealthResponse> {
    let db: string = "unknown";
    let redis: string | undefined;
    let status: ApiHealthResponse["status"] = "ok";

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = "up";
    } catch {
      db = "down";
      status = "degraded";
    }

    const redisUrl = this.config.get<string>("APPDOCK_REDIS_URL");
    if (redisUrl) {
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      client.on("error", () => undefined);
      try {
        await client.connect();
        await client.ping();
        redis = "up";
      } catch {
        // Redis 对 API 非强依赖，仅报告状态不降级
        redis = "down";
      } finally {
        client.disconnect();
      }
    }

    const smtp = (await this.settings.smtpConfigured()) ? true : null;
    return {
      status,
      service: "appdock-api",
      db,
      ...(redis !== undefined ? { redis } : {}),
      smtp,
      timestamp: new Date().toISOString(),
    };
  }
}
