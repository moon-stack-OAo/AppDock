import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

export class PatchNotifyDto {
  @IsOptional()
  @IsBoolean()
  notifyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnSyncSuccess?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnSyncFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnUploadSuccess?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notifyEmails?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(["viewer", "operator", "manager"], { each: true })
  notifyMemberRoles?: string[];

  @IsOptional()
  @IsBoolean()
  notifyUseGlobalFallback?: boolean;
}
