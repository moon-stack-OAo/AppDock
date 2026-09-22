import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 主密钥不足 32 字节时用 sha256 拉到 32；已是 32 字节则原样使用。 */
export function deriveMasterKey(raw: string): Buffer {
  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;
  return createHash("sha256").update(utf8).digest();
}

export function generatePlainCode(): string {
  const bytes = randomBytes(24);
  let body = "";
  for (let i = 0; i < 24; i += 1) {
    body += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `dock_${body}`;
}

export function codePrefixOf(plain: string): string {
  return plain.slice(0, 8);
}

export function maskPrefix(prefix: string): string {
  return `${prefix}••••`;
}

/** scrypt 哈希，格式 `scrypt$<salt b64>$<hash b64>`。 */
export function hashAccessCode(plain: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyAccessCode(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "base64");
    expected = Buffer.from(parts[2], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(plain, salt, expected.length, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** AES-256-GCM，密文为 base64(iv 12 + tag 16 + ciphertext)。 */
export function encryptAccessCode(plain: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptAccessCode(codeEnc: string, masterKey: Buffer): string {
  const buf = Buffer.from(codeEnc, "base64");
  if (buf.length <= IV_LEN + TAG_LEN) {
    throw new Error("ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
