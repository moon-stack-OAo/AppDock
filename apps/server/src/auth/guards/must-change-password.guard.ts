import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { User } from "@prisma/client";
import {
  ALLOW_MUST_CHANGE_PASSWORD_KEY,
  IS_PUBLIC_KEY,
} from "../auth.constants";

@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allow = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MUST_CHANGE_PASSWORD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allow) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    if (req.user?.mustChangePassword) {
      throw new ForbiddenException({
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "请先修改初始密码后再继续使用",
        },
      });
    }
    return true;
  }
}
