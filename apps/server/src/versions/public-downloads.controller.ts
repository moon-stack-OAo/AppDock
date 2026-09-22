import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { User } from "@prisma/client";
import { Request, Response } from "express";
import { UserStatus } from "@appdock/shared";
import { Public } from "../auth/decorators/public.decorator";
import { AccessTokenPayload } from "../auth/auth.constants";
import { UsersService } from "../users/users.service";
import { ACCESS_SESSION_COOKIE } from "../access-codes/access-code.constants";
import { AccessCodesService } from "../access-codes/access-codes.service";
import { UnlockDto } from "../access-codes/dto/unlock.dto";
import { VersionsService } from "./versions.service";

@Controller("public/apps")
export class PublicDownloadsController {
  constructor(
    private readonly versions: VersionsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly accessCodes: AccessCodesService,
  ) {}

  @Public()
  @Get()
  list() {
    return this.versions.publicList();
  }

  @Public()
  @Post(":slug/unlock")
  @HttpCode(200)
  unlock(
    @Param("slug") slug: string,
    @Body() dto: UnlockDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.accessCodes.unlock(slug, dto.accessCode, res);
  }

  @Public()
  @Post(":slug/lock")
  @HttpCode(200)
  lock(@Res({ passthrough: true }) res: Response) {
    return this.accessCodes.lock(res);
  }

  @Public()
  @Get(":slug/updates/check")
  checkUpdate(
    @Param("slug") slug: string,
    @Query("currentVersion") currentVersion: string | undefined,
    @Query("platform") platform: string | undefined,
    @Query("arch") arch: string | undefined,
    @Req() req: Request,
  ) {
    return this.withAccess(req, (actor, access) =>
      this.versions.checkUpdate(slug, actor, access, {
        currentVersion: currentVersion ?? "",
        platform: platform ?? "",
        arch: arch ?? "",
      }),
    );
  }

  @Public()
  @Get(":slug")
  app(@Param("slug") slug: string, @Req() req: Request) {
    return this.withAccess(req, (actor, access) => this.versions.publicApp(slug, actor, access));
  }

  @Public()
  @Get(":slug/versions")
  listVersions(
    @Param("slug") slug: string,
    @Query("includePrerelease") includePrerelease: string | undefined,
    @Req() req: Request,
  ) {
    return this.withAccess(req, (actor, access) =>
      this.versions.publicVersions(slug, actor, includePrerelease === "true", access),
    );
  }

  @Public()
  @Get(":slug/versions/:tag")
  version(@Param("slug") slug: string, @Param("tag") tag: string, @Req() req: Request) {
    return this.withAccess(req, (actor, access) =>
      this.versions.publicVersionByTag(slug, tag, actor, access),
    );
  }

  @Public()
  @Get(":slug/assets/:assetId/download")
  async download(
    @Param("slug") slug: string,
    @Param("assetId") assetId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const actor = await this.optionalActor(req);
    const access = await this.optionalAccess(req);
    const file = await this.versions.openDownload(slug, assetId, actor, access);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", String(file.size));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    file.stream.pipe(res);
  }

  private async withAccess<T>(
    req: Request,
    run: (actor: User | null, access: { codeId?: string; allowedAppIds: string[] }) => Promise<T>,
  ) {
    const actor = await this.optionalActor(req);
    const access = await this.optionalAccess(req);
    return run(actor, access);
  }

  private async optionalAccess(req: Request): Promise<{ codeId?: string; allowedAppIds: string[] }> {
    const token = req.cookies?.[ACCESS_SESSION_COOKIE] as string | undefined;
    if (!token) return { allowedAppIds: [] };
    try {
      const payload = await this.jwt.verifyAsync<{
        codeId?: string;
        allowedAppIds?: string[];
        typ?: string;
      }>(token, {
        secret: this.config.getOrThrow<string>("APPDOCK_JWT_SECRET"),
        audience: "access_code",
      });
      if (payload.typ !== "access_code" || !payload.codeId) return { allowedAppIds: [] };
      return { codeId: payload.codeId, allowedAppIds: payload.allowedAppIds ?? [] };
    } catch {
      return { allowedAppIds: [] };
    }
  }

  private async optionalActor(req: Request): Promise<User | null> {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) return null;
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>("APPDOCK_JWT_SECRET"),
      });
      if (payload.typ !== "access" || !payload.sub) return null;
      const user = await this.users.findById(payload.sub);
      if (!user || user.status === UserStatus.Disabled) {
        throw new UnauthorizedException({
          error: { code: "UNAUTHORIZED", message: "未登录或令牌无效" },
        });
      }
      return user;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      return null;
    }
  }
}
