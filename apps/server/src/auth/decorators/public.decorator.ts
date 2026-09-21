import { SetMetadata } from "@nestjs/common";
import { IS_PUBLIC_KEY } from "../auth.constants";

/** 跳过 JWT 鉴权（login / refresh / health 等） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
