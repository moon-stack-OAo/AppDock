import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import { Response } from "express";
import { User } from "@prisma/client";
import { UserStatus } from "@appdock/shared";
import { PublicUser, UsersService } from "../users/users.service";
import { AuditService } from "../audit/audit.service";
import {
  AccessTokenPayload,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  RefreshTokenPayload,
} from "./auth.constants";

export type LoginResult = {
  accessToken: string;
  expiresIn: number;
  user: PublicUser;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  get accessTtlSec(): number {
    return Number(this.config.get("APPDOCK_JWT_ACCESS_TTL_SEC") ?? 3600);
  }

  get refreshTtlSec(): number {
    return Number(this.config.get("APPDOCK_JWT_REFRESH_TTL_SEC") ?? 604800);
  }

  private get secret(): string {
    return this.config.getOrThrow<string>("APPDOCK_JWT_SECRET");
  }

  async login(login: string, password: string, res: Response): Promise<LoginResult> {
    const user = await this.users.findByLogin(login);
    if (!user) {
      throw new UnauthorizedException({
        error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" },
      });
    }
    if (user.status === UserStatus.Disabled) {
      throw new UnauthorizedException({
        error: { code: "ACCOUNT_DISABLED", message: "账号已停用" },
      });
    }

    const ok = await this.users.verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" },
      });
    }

    const accessToken = await this.signAccess(user);
    const refreshToken = await this.signRefresh(user);
    this.setRefreshCookie(res, refreshToken);

    return {
      accessToken,
      expiresIn: this.accessTtlSec,
      user: this.users.toPublicUser(user),
    };
  }

  async refresh(refreshToken: string | undefined, res: Response): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    if (!refreshToken) {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "未登录或令牌无效" },
      });
    }

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.secret,
      });
    } catch {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "未登录或令牌无效" },
      });
    }

    if (payload.typ !== "refresh" || !payload.sub) {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "未登录或令牌无效" },
      });
    }

    const user = await this.users.findById(payload.sub);
    if (!user || user.status === UserStatus.Disabled) {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "未登录或令牌无效" },
      });
    }

    const accessToken = await this.signAccess(user);
    const newRefresh = await this.signRefresh(user);
    this.setRefreshCookie(res, newRefresh);

    return { accessToken, expiresIn: this.accessTtlSec };
  }

  logout(res: Response): { ok: true } {
    this.clearRefreshCookie(res);
    return { ok: true };
  }

  async me(user: User): Promise<PublicUser> {
    return this.users.toPublicUser(user);
  }

  async changePassword(
    user: User,
    currentPassword: string,
    newPassword: string,
    res: Response,
  ): Promise<{ ok: true }> {
    if (newPassword.length < 8) {
      throw new BadRequestException({
        error: {
          code: "WEAK_PASSWORD",
          message: "新密码至少 8 位",
        },
      });
    }

    const ok = await this.users.verifyPassword(
      currentPassword,
      user.passwordHash,
    );
    if (!ok) {
      throw new BadRequestException({
        error: {
          code: "INVALID_CURRENT_PASSWORD",
          message: "当前密码不正确",
        },
      });
    }

    const passwordHash = await this.users.hashPassword(newPassword);
    const updated = await this.users.updatePassword(user.id, passwordHash, {
      clearMustChangePassword: true,
    });

    this.logger.log(
      `user.password_change userId=${updated.id} username=${updated.username}`,
    );
    await this.audit.record({
      actorUserId: updated.id,
      action: "user.password_change",
      targetType: "user",
      targetId: updated.id,
      meta: { username: updated.username },
    });

    const newRefresh = await this.signRefresh(updated);
    this.setRefreshCookie(res, newRefresh);

    return { ok: true };
  }

  private async signAccess(user: User): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      typ: "access",
    };
    return this.jwt.signAsync(payload, {
      secret: this.secret,
      expiresIn: this.accessTtlSec,
      algorithm: "HS256",
    });
  }

  private async signRefresh(user: User): Promise<string> {
    const payload: RefreshTokenPayload = {
      sub: user.id,
      jti: randomUUID(),
      typ: "refresh",
    };
    return this.jwt.signAsync(payload, {
      secret: this.secret,
      expiresIn: this.refreshTtlSec,
      algorithm: "HS256",
    });
  }

  setRefreshCookie(res: Response, token: string): void {
    const isProd = process.env.NODE_ENV === "production";
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      path: REFRESH_COOKIE_PATH,
      sameSite: "lax",
      secure: isProd,
      maxAge: this.refreshTtlSec * 1000,
    });
  }

  clearRefreshCookie(res: Response): void {
    const isProd = process.env.NODE_ENV === "production";
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      path: REFRESH_COOKIE_PATH,
      sameSite: "lax",
      secure: isProd,
    });
  }
}
