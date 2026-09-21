import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import cookieParser from "cookie-parser";
import { API_PREFIX } from "@appdock/shared";
import { resolveAppDockPaths } from "./config/resolve-paths";
import { AppModule } from "./app.module";

async function bootstrap() {
  resolveAppDockPaths();

  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>("APPDOCK_PORT", 3080);

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""));

  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}${API_PREFIX}`, "Bootstrap");
}

bootstrap();
