import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { json, urlencoded } from "express";
import type { NextFunction, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import cookieParser from "cookie-parser";
import { API_PREFIX } from "@appdock/shared";
import { resolveAppDockPaths } from "./config/resolve-paths";
import { AppModule } from "./app.module";

const GITHUB_HOOK_PATH = `${API_PREFIX}/hooks/github`;

async function bootstrap() {
  resolveAppDockPaths();

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  const port = config.get<number>("APPDOCK_PORT", 3080);

  // 仅 GitHub webhook 保留原始 body，供 HMAC 验签；其余 JSON 接口行为不变
  app.use(
    json({
      verify: (req, _res, buf) => {
        const url = req.url ?? "";
        if (url === GITHUB_HOOK_PATH || url.startsWith(`${GITHUB_HOOK_PATH}?`)) {
          (req as { rawBody?: Buffer }).rawBody = buf;
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""));

  const indexHtml = path.resolve(__dirname, "../../web/dist/index.html");
  if (fs.existsSync(indexHtml)) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const url = req.path || "/";
      if (url === "/api" || url.startsWith("/api/")) return next();
      if (path.extname(url)) return next();
      res.sendFile(indexHtml);
    });
  }

  const host = config.get<string>("APPDOCK_HOST", "0.0.0.0");
  await app.listen(port, host);
  Logger.log(`API  http://127.0.0.1:${port}${API_PREFIX}  (bind ${host})`, "Bootstrap");
  Logger.log(`Health  http://127.0.0.1:${port}${API_PREFIX}/health`, "Bootstrap");
}

bootstrap();
