import { SetMetadata } from "@nestjs/common";
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from "../auth.constants";

/** 允许 mustChangePassword=true 的用户访问（me / change-password / logout） */
export const AllowMustChangePassword = () =>
  SetMetadata(ALLOW_MUST_CHANGE_PASSWORD_KEY, true);
