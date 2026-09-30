import { ConfigService } from "@nestjs/config";
import { ConnectionOptions } from "bullmq";

export function redisConnection(config: ConfigService): ConnectionOptions {
  const url = config.get<string>("APPDOCK_REDIS_URL", "redis://127.0.0.1:6379");
  return {
    url,
    maxRetriesPerRequest: null,
    connectTimeout: 2000,
    retryStrategy: () => null,
  };
}
