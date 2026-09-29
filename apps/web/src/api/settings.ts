import { apiRequest } from "./http";

export type SmtpView = {
  enabled: boolean;
  host: string;
  port: number;
  encryption: "ssl_tls" | "starttls" | "none";
  username: string;
  passwordSet: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  connectTimeoutSec: number;
};

export type SettingsView = {
  siteName: string;
  publicBaseUrl: string;
  defaultPollIntervalSec: number;
  maxAssetSizeBytes: number;
  storageRoot: string;
  notifyGlobalEmails: string[];
  smtp: SmtpView;
};

export type SmtpPatch = {
  enabled?: boolean;
  host?: string;
  port?: number;
  encryption?: SmtpView["encryption"];
  username?: string;
  password?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string | null;
  connectTimeoutSec?: number;
};

export function getSettings() {
  return apiRequest<SettingsView>("/admin/settings");
}

export function patchSettings(body: {
  siteName?: string;
  publicBaseUrl?: string;
  defaultPollIntervalSec?: number;
  maxAssetSizeBytes?: number;
  notifyGlobalEmails?: string[];
  smtp?: SmtpPatch;
}) {
  return apiRequest<SettingsView>("/admin/settings", { method: "PATCH", body });
}

export function testSmtp(body: { to?: string; smtp?: SmtpPatch }) {
  return apiRequest<{ ok: true; to: string }>("/admin/settings/smtp/test", { method: "POST", body });
}

export type AppNotify = {
  notifyEnabled: boolean;
  notifyOnSyncSuccess: boolean;
  notifyOnSyncFailure: boolean;
  notifyOnUploadSuccess: boolean;
  notifyEmails: string[];
  notifyMemberRoles: string[];
  notifyUseGlobalFallback: boolean;
};

export function getAppNotify(appId: string) {
  return apiRequest<AppNotify>(`/admin/apps/${appId}/notify`);
}

export function patchAppNotify(appId: string, body: AppNotify) {
  return apiRequest<AppNotify>(`/admin/apps/${appId}/notify`, { method: "PATCH", body });
}

export function testAppNotify(appId: string) {
  return apiRequest<{ ok: true; recipients: number }>(`/admin/apps/${appId}/notify/test`, {
    method: "POST",
  });
}
