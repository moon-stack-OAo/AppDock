import { SetMetadata } from "@nestjs/common";
import { UserRole } from "@appdock/shared";
import { ROLES_KEY } from "../auth.constants";

/** 要求 request.user.role 命中其一；无此装饰器则 RolesGuard 放行 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
