import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export class SmtpPatchDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsIn(["ssl_tls", "starttls", "none"])
  encryption?: "ssl_tls" | "starttls" | "none";

  @IsOptional()
  @IsString()
  username?: string;

  /** 省略=不改；空字符串=清除；非空=更新。 */
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsOptional()
  @IsString()
  fromEmail?: string;

  @IsOptional()
  @IsString()
  replyTo?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  connectTimeoutSec?: number;
}

export class PatchSettingsDto {
  @IsOptional()
  @IsString()
  siteName?: string;

  @IsOptional()
  @IsString()
  publicBaseUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  defaultPollIntervalSec?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxAssetSizeBytes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notifyGlobalEmails?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SmtpPatchDto)
  smtp?: SmtpPatchDto;
}

export class SmtpTestDto {
  @IsEmail()
  to!: string;
}
