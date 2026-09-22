import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { UserRole, UserStatus } from "@appdock/shared";

export class UpdateUserDto {
  @IsOptional()
  @IsIn([UserRole.Admin, UserRole.User])
  role?: UserRole;

  @IsOptional()
  @IsIn([UserStatus.Active, UserStatus.Disabled])
  status?: UserStatus;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: "密码至少 8 位" })
  password?: string;
}
