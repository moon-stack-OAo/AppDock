export const SETTING_KEYS = {
  siteName: "siteName",
  publicBaseUrl: "publicBaseUrl",
  defaultPollIntervalSec: "defaultPollIntervalSec",
  maxAssetSizeBytes: "maxAssetSizeBytes",
  notifyGlobalEmails: "notifyGlobalEmails",
  smtp: "smtp",
} as const;

export type SmtpEncryption = "ssl_tls" | "starttls" | "none";

/** 落库的 SMTP。passwordEnc 为 AES-256-GCM，GET 永不回传。 */
export type StoredSmtp = {
  enabled: boolean;
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  passwordEnc: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  connectTimeoutSec: number;
};

export type PublicSmtp = {
  enabled: boolean;
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  passwordSet: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  connectTimeoutSec: number;
};

export type PublicSettings = {
  siteName: string;
  publicBaseUrl: string;
  defaultPollIntervalSec: number;
  maxAssetSizeBytes: number;
  storageRoot: string;
  notifyGlobalEmails: string[];
  smtp: PublicSmtp;
};

export const MEMBER_ROLES = ["viewer", "operator", "manager"] as const;
