import { IsIn, IsString, MinLength } from "class-validator";
import { AppPermission } from "@appdock/shared";

export class UpsertMemberDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsIn([AppPermission.Viewer, AppPermission.Operator, AppPermission.Manager])
  permission!: AppPermission;
}
