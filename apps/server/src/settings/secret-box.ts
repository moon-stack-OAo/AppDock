import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { decryptAccessCode, deriveMasterKey, encryptAccessCode } from "../access-codes/access-code.crypto";

/**
 * SMTP 密码与口令中心同一套 AES-256-GCM。
 * 优先 APPDOCK_ACCESS_CODE_MASTER_KEY；没有才用 JWT secret 派生。
 */
export function smtpMasterKey(config: ConfigService): Buffer {
  const dedicated = config.get<string>("APPDOCK_ACCESS_CODE_MASTER_KEY")?.trim();
  if (dedicated) return deriveMasterKey(dedicated);
  const jwt = config.get<string>("APPDOCK_JWT_SECRET")?.trim() || "appdock-dev";
  return createHash("sha256").update(`appdock-smtp:${jwt}`).digest();
}

export function encryptSecret(plain: string, config: ConfigService): string {
  return encryptAccessCode(plain, smtpMasterKey(config));
}

export function decryptSecret(enc: string, config: ConfigService): string {
  return decryptAccessCode(enc, smtpMasterKey(config));
}
