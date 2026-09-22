import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Prisma, User } from "@prisma/client";
import { UserRole, UserStatus } from "@appdock/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

export type PublicUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: string;
  mustChangePassword: boolean;
};

export type AdminUserView = PublicUser & {
  status: string;
  createdAt: Date;
};

const USER_PUBLIC_SELECT = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  role: true,
  status: true,
  mustChangePassword: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * login 含 @：先 email 再 username；否则先 username 再 email
   */
  async findByLogin(login: string): Promise<User | null> {
    const trimmed = login.trim();
    if (!trimmed) return null;

    if (trimmed.includes("@")) {
      return (
        (await this.findByEmail(trimmed)) ??
        (await this.findByUsername(trimmed))
      );
    }
    return (
      (await this.findByUsername(trimmed)) ??
      (await this.findByEmail(trimmed))
    );
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
    opts?: { clearMustChangePassword?: boolean },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        ...(opts?.clearMustChangePassword ? { mustChangePassword: false } : {}),
      },
    });
  }

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }

  toAdminUser(user: {
    id: string;
    username: string;
    email: string;
    displayName: string | null;
    role: string;
    status: string;
    mustChangePassword: boolean;
    createdAt: Date;
  }): AdminUserView {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    };
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  listPublic(): Promise<AdminUserView[]> {
    return this.prisma.user.findMany({
      select: USER_PUBLIC_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async createByAdmin(actor: User, dto: CreateUserDto): Promise<AdminUserView> {
    const username = dto.username.trim();
    const email = dto.email.trim().toLowerCase();
    const displayName = dto.displayName?.trim() || null;
    const role = dto.role ?? UserRole.User;

    if (!username) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "用户名不能为空" },
      });
    }
    if (role !== UserRole.Admin && role !== UserRole.User) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "角色仅允许 admin 或 user" },
      });
    }
    if (dto.password.length < 8) {
      throw new BadRequestException({
        error: { code: "WEAK_PASSWORD", message: "密码至少 8 位" },
      });
    }

    const passwordHash = await this.hashPassword(dto.password);
    try {
      const created = await this.prisma.user.create({
        data: {
          username,
          email,
          displayName,
          passwordHash,
          role,
          status: UserStatus.Active,
          mustChangePassword: true,
        },
        select: USER_PUBLIC_SELECT,
      });
      await this.audit.record({
        actorUserId: actor.id,
        action: "user.create",
        targetType: "user",
        targetId: created.id,
        meta: { username: created.username, role: created.role },
      });
      return created;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException({
          error: { code: "USER_EXISTS", message: "用户名或邮箱已存在" },
        });
      }
      throw err;
    }
  }

  async updateByAdmin(
    actor: User,
    id: string,
    dto: UpdateUserDto,
  ): Promise<AdminUserView> {
    const target = await this.findById(id);
    if (!target) {
      throw new NotFoundException({
        error: { code: "NOT_FOUND", message: "用户不存在" },
      });
    }

    const nextRole = dto.role;
    const nextStatus = dto.status;
    const email =
      dto.email === undefined ? undefined : dto.email.trim().toLowerCase();
    const displayName =
      dto.displayName === undefined ? undefined : dto.displayName.trim() || null;
    const resettingPassword = dto.password !== undefined;

    if (resettingPassword && dto.password!.length < 8) {
      throw new BadRequestException({
        error: { code: "WEAK_PASSWORD", message: "密码至少 8 位" },
      });
    }
    if (
      nextRole !== undefined &&
      nextRole !== UserRole.Admin &&
      nextRole !== UserRole.User
    ) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "角色仅允许 admin 或 user" },
      });
    }
    if (
      nextStatus !== undefined &&
      nextStatus !== UserStatus.Active &&
      nextStatus !== UserStatus.Disabled
    ) {
      throw new BadRequestException({
        error: { code: "BAD_REQUEST", message: "状态仅允许 active 或 disabled" },
      });
    }

    const roleChanged = nextRole !== undefined && nextRole !== target.role;
    const statusChanged =
      nextStatus !== undefined && nextStatus !== target.status;
    const disablingSelf =
      actor.id === target.id &&
      nextStatus === UserStatus.Disabled &&
      target.status !== UserStatus.Disabled;
    const demotingSelf =
      actor.id === target.id &&
      roleChanged &&
      target.role === UserRole.Admin &&
      nextRole !== UserRole.Admin;
    if (disablingSelf || demotingSelf) {
      throw new BadRequestException({
        error: {
          code: "CANNOT_MODIFY_SELF",
          message: "不能停用或降级自己",
        },
      });
    }

    const willLoseAdmin =
      target.role === UserRole.Admin &&
      target.status === UserStatus.Active &&
      ((roleChanged && nextRole !== UserRole.Admin) ||
        (statusChanged && nextStatus === UserStatus.Disabled));
    if (willLoseAdmin) {
      const otherActiveAdmins = await this.prisma.user.count({
        where: {
          id: { not: target.id },
          role: UserRole.Admin,
          status: UserStatus.Active,
        },
      });
      if (otherActiveAdmins === 0) {
        throw new BadRequestException({
          error: {
            code: "LAST_ADMIN",
            message: "至少保留一名启用的管理员",
          },
        });
      }
    }

    if (email !== undefined && email !== target.email) {
      const taken = await this.findByEmail(email);
      if (taken && taken.id !== target.id) {
        throw new ConflictException({
          error: { code: "USER_EXISTS", message: "用户名或邮箱已存在" },
        });
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (roleChanged && nextRole !== undefined) data.role = nextRole;
    if (statusChanged && nextStatus !== undefined) data.status = nextStatus;
    if (displayName !== undefined) data.displayName = displayName;
    if (email !== undefined) data.email = email;
    if (resettingPassword) {
      data.passwordHash = await this.hashPassword(dto.password!);
      data.mustChangePassword = true;
    }

    let updated: AdminUserView;
    try {
      updated = await this.prisma.user.update({
        where: { id: target.id },
        data,
        select: USER_PUBLIC_SELECT,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException({
          error: { code: "USER_EXISTS", message: "用户名或邮箱已存在" },
        });
      }
      throw err;
    }

    if (roleChanged && nextRole !== undefined) {
      await this.audit.record({
        actorUserId: actor.id,
        action: "user.role_change",
        targetType: "user",
        targetId: target.id,
        meta: { from: target.role, to: nextRole },
      });
    }
    if (statusChanged && nextStatus === UserStatus.Disabled) {
      await this.audit.record({
        actorUserId: actor.id,
        action: "user.disable",
        targetType: "user",
        targetId: target.id,
        meta: { username: target.username },
      });
    }
    if (statusChanged && nextStatus === UserStatus.Active) {
      await this.audit.record({
        actorUserId: actor.id,
        action: "user.enable",
        targetType: "user",
        targetId: target.id,
        meta: { username: target.username },
      });
    }
    if (resettingPassword) {
      await this.audit.record({
        actorUserId: actor.id,
        action: "user.password_change",
        targetType: "user",
        targetId: target.id,
        meta: { via: "admin_reset" },
      });
    }

    return updated;
  }
}
