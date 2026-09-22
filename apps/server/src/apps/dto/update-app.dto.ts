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

export class UpdateAppDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  /** 存在且不同于当前值时服务层拒绝 SLUG_IMMUTABLE */
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  releaseProvider?: string;

  @IsOptional()
  @IsString()
  releaseOwner?: string | null;

  @IsOptional()
  @IsString()
  releaseRepo?: string | null;

  @IsOptional()
  @IsString()
  releaseBaseUrl?: string | null;

  @IsOptional()
  @IsString()
  releaseProjectId?: string | null;

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
  syncPollIntervalSec?: number | null;

  @IsOptional()
  @IsString()
  assetIncludeGlob?: string | null;

  @IsOptional()
  @IsString()
  assetExcludeGlob?: string | null;

  @IsOptional()
  @IsBoolean()
  latestReleaseOnly?: boolean;

  @IsOptional()
  @IsString()
  storagePrefix?: string | null;

  @IsOptional()
  @IsString()
  iconUrl?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  /** JSON 数组。非法条目由推断侧忽略，这里只要求是数组。 */
  @IsOptional()
  @IsArray()
  platformRules?: unknown[] | null;

  @IsOptional()
  @IsString()
  githubOwner?: string;

  @IsOptional()
  @IsString()
  githubRepo?: string;
}
