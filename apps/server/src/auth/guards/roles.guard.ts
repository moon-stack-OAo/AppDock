import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { User } from "@prisma/client";
import { UserRole } from "@appdock/shared";
import { IS_PUBLIC_KEY, ROLES_KEY } from "../auth.constants";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const role = req.user?.role;
    if (!role || !roles.includes(role as UserRole)) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "需要管理员权限" },
      });
    }
    return true;
  }
}
