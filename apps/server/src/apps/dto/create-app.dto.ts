import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateAppDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  releaseProvider?: string;

  @IsOptional()
  @IsString()
  releaseOwner?: string;

  @IsOptional()
  @IsString()
  releaseRepo?: string;

  @IsOptional()
  @IsString()
  releaseBaseUrl?: string;

  @IsOptional()
  @IsString()
  releaseProjectId?: string;

  @IsOptional()
  @IsString()
  visibility?: string;

  @IsOptional()
  @IsBoolean()
  syncWebhookEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  syncPollEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  syncPollIntervalSec?: number;

  @IsOptional()
  @IsString()
  assetIncludeGlob?: string;

  @IsOptional()
  @IsString()
  assetExcludeGlob?: string;

  @IsOptional()
  @IsBoolean()
  latestReleaseOnly?: boolean;

  @IsOptional()
  @IsString()
  storagePrefix?: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  platformRules?: unknown[];

  /** 兼容别名，映射为 releaseOwner */
  @IsOptional()
  @IsString()
  githubOwner?: string;

  /** 兼容别名，映射为 releaseRepo */
  @IsOptional()
  @IsString()
  githubRepo?: string;
}
