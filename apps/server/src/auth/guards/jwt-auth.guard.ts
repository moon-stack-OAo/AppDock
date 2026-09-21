import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { UsersService } from "../../users/users.service";
import {
  AccessTokenPayload,
  IS_PUBLIC_KEY,
} from "../auth.constants";
import { UserStatus } from "@appdock/shared";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = this.extractBearer(req);
    if (!token) {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "未登录或令牌无效" },
      });
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>("APPDOCK_JWT_SECRET"),
      });
    } catch {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "未登录或令牌无效" },
      });
    }

    if (payload.typ !== "access" || !payload.sub) {
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

    req.user = user;
    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) return null;
    return token;
  }
}
