import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { findRepoRoot } from "../config/resolve-paths";
import { Storage } from "./storage.interface";

@Injectable()
export class LocalStorageService implements Storage {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>("APPDOCK_STORAGE_ROOT");
    if (configured && configured.trim()) {
      this.root = path.resolve(configured.trim());
    } else {
      this.root = path.resolve(findRepoRoot(), "data", "files");
    }
    this.logger.log(`storage root ${this.root}`);
  }

  async put(key: string, srcPath: string): Promise<void> {
    const dest = this.resolveKey(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(srcPath, dest);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        await fsp.copyFile(srcPath, dest);
        await fsp.unlink(srcPath);
        return;
      }
      throw err;
    }
  }

  async putStream(key: string, source: NodeJS.ReadableStream): Promise<number> {
    const dest = this.resolveKey(key);
    const tmp = `${dest}.${process.pid}.${Date.now()}.part`;
    try {
      const bytes = await this.writeTemp(dest, tmp, source);
      await fsp.rename(tmp, dest);
      return bytes;
    } catch (err) {
      await fsp.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  /** 流写入同目录临时文件并返回字节数，不替换已有目标。供覆盖前暂存。 */
  async stageStream(key: string, source: NodeJS.ReadableStream): Promise<{ bytes: number; token: string }> {
    const dest = this.resolveKey(key);
    const token = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
    const tmp = `${dest}.${token}.part`;
    try {
      const bytes = await this.writeTemp(dest, tmp, source);
      return { bytes, token };
    } catch (err) {
      await fsp.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  /** 把 stageStream 的临时文件改名为最终 key。 */
  async commitStaged(key: string, token: string): Promise<void> {
    const dest = this.resolveKey(key);
    const tmp = `${dest}.${token}.part`;
    await fsp.rename(tmp, dest);
  }

  /** 删除 stageStream 留下的临时文件。 */
  async discardStaged(key: string, token: string): Promise<void> {
    const dest = this.resolveKey(key);
    await fsp.unlink(`${dest}.${token}.part`).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }

  private async writeTemp(dest: string, tmp: string, source: NodeJS.ReadableStream): Promise<number> {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
        callback(null, chunk);
      },
    });
    try {
      await pipeline(source, counter, fs.createWriteStream(tmp));
      return bytes;
    } catch (err) {
      counter.destroy();
      throw err;
    }
  }

  async openReadStream(key: string): Promise<NodeJS.ReadableStream> {
    const dest = this.resolveKey(key);
    await fsp.access(dest);
    return fs.createReadStream(dest);
  }

  async delete(key: string): Promise<void> {
    const dest = this.resolveKey(key);
    try {
      await fsp.unlink(dest);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const dest = this.resolveKey(key);
    try {
      await fsp.access(dest);
      return true;
    } catch {
      return false;
    }
  }

  async ensurePrefix(prefix: string): Promise<void> {
    const dest = this.resolveKey(prefix);
    await fsp.mkdir(dest, { recursive: true });
  }

  /** 删除前缀目录（归档 purge）。不存在则忽略。 */
  async removePrefix(prefix: string): Promise<void> {
    const dest = this.resolveKey(prefix);
    await fsp.rm(dest, { recursive: true, force: true });
  }

  private resolveKey(key: string): string {
    if (!key || typeof key !== "string") {
      throw new Error("STORAGE_KEY_INVALID");
    }
    const normalized = key.replace(/\\/g, "/");
    if (normalized.includes("\0")) {
      throw new Error("STORAGE_KEY_INVALID");
    }
    if (path.win32.isAbsolute(key) || path.posix.isAbsolute(normalized)) {
      throw new Error("STORAGE_KEY_INVALID");
    }
    const segments = normalized.split("/");
    if (segments.some((seg) => seg === "..")) {
      throw new Error("STORAGE_KEY_INVALID");
    }
    const dest = path.resolve(this.root, ...segments.filter((seg) => seg !== "" && seg !== "."));
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (dest !== this.root && !dest.startsWith(rootWithSep)) {
      throw new Error("STORAGE_KEY_INVALID");
    }
    return dest;
  }
}
