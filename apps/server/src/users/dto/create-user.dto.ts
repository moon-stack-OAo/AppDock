import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { UserRole } from "@appdock/shared";

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsString()
  @MinLength(8, { message: "密码至少 8 位" })
  password!: string;

  @IsOptional()
  @IsIn([UserRole.Admin, UserRole.User])
  role?: UserRole;
}
