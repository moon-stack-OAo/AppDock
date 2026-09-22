import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fsp from "fs/promises";
import * as path from "path";
import { findRepoRoot } from "../config/resolve-paths";

@Injectable()
export class MaintenanceService {
  constructor(private readonly config: ConfigService) {}

  /**
   * 拷贝 SQLite 主库及同目录的 -wal/-shm。
   * 不调用 sqlite3，繁忙时快照可能不一致，调用方应在低峰执行。
   */
  async backupDatabase() {
    const dbPath = this.resolveDbPath();
    try {
      await fsp.access(dbPath);
    } catch {
      throw new ServiceUnavailableException({
        error: { code: "BACKUP_FAILED", message: "找不到数据库文件" },
      });
    }

    const dir = path.join(path.dirname(dbPath), "backups");
    await fsp.mkdir(dir, { recursive: true });
    const stamp = new Date();
    const name = `appdock-${formatStamp(stamp)}.db`;
    const dest = path.join(dir, name);

    await fsp.copyFile(dbPath, dest);
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${dbPath}${suffix}`;
      try {
        await fsp.copyFile(side, `${dest}${suffix}`);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    }

    const stat = await fsp.stat(dest);
    return {
      file: dest,
      bytes: stat.size,
      copiedAt: stamp.toISOString(),
      method: "file-copy" as const,
      note: "这是文件拷贝，繁忙时可能不一致，建议低峰执行。未打包安装包目录。",
    };
  }

  private resolveDbPath(): string {
    const url = this.config.get<string>("APPDOCK_DATABASE_URL", "file:data/appdock.db");
    const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
    if (path.isAbsolute(raw) || raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
      return raw;
    }
    return path.resolve(findRepoRoot(), raw.replace(/^\.\//, ""));
  }
}

function formatStamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}
