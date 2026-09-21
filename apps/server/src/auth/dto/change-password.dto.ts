import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: "新密码至少 8 位" })
  newPassword!: string;
}
