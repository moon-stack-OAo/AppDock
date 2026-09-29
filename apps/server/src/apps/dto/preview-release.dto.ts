import { IsString, MaxLength, MinLength } from "class-validator";

export class PreviewReleaseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  url!: string;
}
