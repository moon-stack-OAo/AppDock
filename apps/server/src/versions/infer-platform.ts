import { AssetPlatform } from "@appdock/shared";

export type InferredAsset = {
  platform: string;
  arch: string;
};

const ARCH_PATTERNS: Array<[RegExp, string]> = [
  [/arm64|aarch64/i, "arm64"],
  [/x86_64|x64|amd64|win64/i, "x64"],
  [/universal/i, "universal"],
  [/(^|[^a-z])ia32|i386|x86([^0-9]|$)/i, "x86"],
];

export function inferArch(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const [re, arch] of ARCH_PATTERNS) {
    if (re.test(lower)) return arch;
  }
  return "unknown";
}

/** 文件名推断平台。手动 platform/arch 优先，缺省才走这里。 */
export function inferPlatform(fileName: string): InferredAsset {
  const lower = fileName.toLowerCase();
  let platform: string = AssetPlatform.Unknown;

  if (/\.ipa($|[.\-_])/.test(lower) || /(^|[.\-_])ios([.\-_]|$)/.test(lower)) {
    platform = AssetPlatform.Ios;
  } else if (/\.(apk|aab)($|[.\-_])/.test(lower)) {
    platform = AssetPlatform.Android;
  } else if (
    /\.(exe|msi)($|[.\-_])/.test(lower) ||
    /(^|[.\-_])(win|windows|setup)([.\-_]|$)/.test(lower)
  ) {
    platform = AssetPlatform.Windows;
  } else if (
    /\.(dmg|pkg)($|[.\-_])/.test(lower) ||
    /(^|[.\-_])(mac|macos|darwin|osx)([.\-_]|$)/.test(lower)
  ) {
    platform = AssetPlatform.Macos;
  } else if (
    /\.(appimage|deb|rpm)($|[.\-_])/.test(lower) ||
    /(^|[.\-_])linux([.\-_]|$)/.test(lower)
  ) {
    platform = AssetPlatform.Linux;
  }

  return { platform, arch: inferArch(fileName) };
}

const PLATFORMS = new Set<string>(Object.values(AssetPlatform));
const ARCHES = new Set(["x64", "arm64", "universal", "x86", "unknown"]);

export type PlatformRule = {
  pattern: string;
  platform: string;
  arch: string;
};

/** 解析 platformRulesJson。非法 JSON、非数组、单条缺字段或 platform/arch 非法则跳过，不抛错。 */
export function parsePlatformRules(raw: string | null | undefined): PlatformRule[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rules: PlatformRule[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const pattern = typeof row.pattern === "string" ? row.pattern.trim() : "";
    const platform = typeof row.platform === "string" ? row.platform.trim().toLowerCase() : "";
    const arch = typeof row.arch === "string" ? row.arch.trim().toLowerCase() : "";
    if (!pattern || !PLATFORMS.has(platform) || !ARCHES.has(arch)) continue;
    rules.push({ pattern, platform, arch });
  }
  return rules;
}

/** 子串，或含 `*` 时按简单 glob（整段文件名）。大小写不敏感。 */
function ruleMatches(pattern: string, fileName: string): boolean {
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(fileName);
  }
  return fileName.toLowerCase().includes(pattern.toLowerCase());
}

/** 命中第一条规则即用；否则走 inferPlatform。规则为空或全部非法时等同未配置。 */
export function resolveAssetMeta(
  fileName: string,
  rulesJson: string | null | undefined,
): InferredAsset {
  for (const rule of parsePlatformRules(rulesJson)) {
    if (ruleMatches(rule.pattern, fileName)) {
      return { platform: rule.platform, arch: rule.arch };
    }
  }
  return inferPlatform(fileName);
}

export function normalizePlatform(
  value: string | undefined | null,
  fileName: string,
  rulesJson?: string | null,
): string {
  const raw = value?.trim().toLowerCase();
  if (raw && PLATFORMS.has(raw)) return raw;
  return resolveAssetMeta(fileName, rulesJson).platform;
}

export function normalizeArch(
  value: string | undefined | null,
  fileName: string,
  rulesJson?: string | null,
): string {
  const raw = value?.trim().toLowerCase();
  if (raw && ARCHES.has(raw)) return raw;
  return resolveAssetMeta(fileName, rulesJson).arch;
}
