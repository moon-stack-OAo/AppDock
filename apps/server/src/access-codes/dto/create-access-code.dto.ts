import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";

export class CreateAccessCodeDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsArray()
  @IsString({ each: true })
  appIds!: string[];

  @IsOptional()
  @IsString()
  @MinLength(10)
  customCode?: string | null;
}
