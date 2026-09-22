import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { resolveAppDockPaths } from "./config/resolve-paths";
import { WorkerModule } from "./queues/worker.module";
import { WorkersBootstrap } from "./queues/workers.bootstrap";

async function bootstrap() {
  resolveAppDockPaths();

  const logger = new Logger("Worker");
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["log", "error", "warn"],
  });

  const workers = app.get(WorkersBootstrap);
  try {
    await workers.start();
    logger.log("Worker consuming release-sync / asset-download / notify");
  } catch (err) {
    logger.error(`Worker 启动失败: ${(err as Error).message}`);
  }

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down…`);
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