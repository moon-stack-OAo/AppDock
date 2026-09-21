import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type PublicUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: string;
  mustChangePassword: boolean;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
