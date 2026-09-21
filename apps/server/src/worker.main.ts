import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { resolveAppDockPaths } from "./config/resolve-paths";
import { AppModule } from "./app.module";

/**
 * Worker 入口占位：探测 Redis，暂不消费队列。
 * 后续接入 BullMQ（release-sync / asset-download / notify）。
 */
async function bootstrap() {
  resolveAppDockPaths();

  const logger = new Logger("Worker");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "error", "warn"],
  });
  const config = app.get(ConfigService);
  const redisUrl = config.get<string>("APPDOCK_REDIS_URL", "redis://127.0.0.1:6379");

  logger.log(`Worker starting, redis=${redisUrl}`);

  let redis: Redis | null = null;
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    await redis.connect();
    const pong = await redis.ping();
    logger.log(`Redis probe ok: ${pong}`);
  } catch (err) {
    logger.warn(`Redis probe failed (Worker 仍保持运行): ${(err as Error).message}`);
  }

  const keepAlive = setInterval(() => {
    logger.debug("Worker idle (queue consumer not implemented yet)");
  }, 60_000);

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down…`);
    clearInterval(keepAlive);
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
