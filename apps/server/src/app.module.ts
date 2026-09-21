import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as path from "path";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 仓库根 .env 优先，其次 apps/server/.env
      envFilePath: [
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "../../.env"),
        path.resolve(__dirname, "../../../.env"),
        path.resolve(__dirname, "../.env"),
      ],
    }),
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
  ],
})
export class AppModule {}
