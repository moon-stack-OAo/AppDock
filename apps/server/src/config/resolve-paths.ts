import * as fs from "fs";
import * as path from "path";

/** 向上查找仓库根或发行包根（含 .env 或 pnpm-workspace.yaml）。 */
export function findRepoRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(dir, ".env"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, "../..");
}

function isAbsoluteFileUrl(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath);
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

/**
 * 加载仓库根 .env，并将相对的 file: / 存储路径解析到仓库根。
 * Compose 内 file:/data/... 保持不变。
 */
export function resolveAppDockPaths(repoRoot = findRepoRoot()): void {
  loadEnvFile(path.join(repoRoot, ".env"));
  loadEnvFile(path.join(repoRoot, "apps/server/.env"));

  const dbUrl = process.env.APPDOCK_DATABASE_URL;
  if (dbUrl?.startsWith("file:")) {
    const raw = dbUrl.slice("file:".length);
    if (!isAbsoluteFileUrl(raw)) {
      const marker = raw.replace(/\\/g, "/").match(/(?:^|\/)(data\/.*)$/);
      const rel = marker?.[1] ?? raw.replace(/^\.\.\/+/g, "").replace(/^\.\//, "");
      process.env.APPDOCK_DATABASE_URL = `file:${path.resolve(repoRoot, rel)}`;
    }
  }

  const storage = process.env.APPDOCK_STORAGE_ROOT;
  if (storage && !isAbsoluteFileUrl(storage) && !path.isAbsolute(storage)) {
    const marker = storage.replace(/\\/g, "/").match(/(?:^|\/)(data\/.*)$/);
    const rel = marker?.[1] ?? storage.replace(/^\.\.\/+/g, "").replace(/^\.\//, "");
    process.env.APPDOCK_STORAGE_ROOT = path.resolve(repoRoot, rel);
  }
}
