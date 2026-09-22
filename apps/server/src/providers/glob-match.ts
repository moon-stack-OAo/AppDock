/** 逗号分隔的简单 glob：仅支持 * 与字面量，大小写不敏感。空规则视为不限制。 */
export function matchName(fileName: string, includeGlob: string | null, excludeGlob: string | null): boolean {
  const include = splitGlobs(includeGlob);
  const exclude = splitGlobs(excludeGlob);
  if (include.length > 0 && !include.some((pattern) => globMatch(pattern, fileName))) {
    return false;
  }
  if (exclude.some((pattern) => globMatch(pattern, fileName))) {
    return false;
  }
  return true;
}

function splitGlobs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}
