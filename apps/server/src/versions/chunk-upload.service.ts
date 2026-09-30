import { ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { User } from "@prisma/client";
import { randomUUID } from "crypto";
import * as fs from "fs";
import { Readable } from "stream";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { VersionsService, type UploadMeta } from "./versions.service";

/** 单片上限，低于常见 100MB 反代限制。 */
export const CHUNK_SIZE = 50 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type ChunkSessionView = {
  uploadId: string;
  chunkSize: number;
  fileSize: number;
  totalChunks: number;
  fileName: string;
};

type ChunkSession = {
  uploadId: string;
  actorId: string;
  appId: string;
  versionId?: string;
  meta: UploadMeta;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  contentType: string;
  dir: string;
  received: Set<number>;
  expiresAt: number;
};

@Injectable()
export class ChunkUploadService {
  private readonly sessions = new Map<string, ChunkSession>();

  constructor(private readonly versions: VersionsService) {}

  async initNewVersion(
    actor: User,
    appId: string,
    meta: UploadMeta,
    file: { fileName: string; fileSize: number; contentType?: string },
  ): Promise<ChunkSessionView> {
    await this.versions.assertCanUploadNew(actor, appId, meta);
    return this.open(actor, appId, undefined, meta, file);
  }

  async initAssets(
    actor: User,
    versionId: string,
    meta: UploadMeta,
    file: { fileName: string; fileSize: number; contentType?: string },
  ): Promise<ChunkSessionView> {
    const appId = await this.versions.assertCanUploadAssets(actor, versionId);
    return this.open(actor, appId, versionId, meta, file);
  }

  async putChunk(actor: User, uploadId: string, index: number, filePath: string, size: number) {
    const session = this.take(actor, uploadId);
    if (!filePath) {
      throw new ConflictException({
        error: { code: "CHUNK_REQUIRED", message: "缺少分片数据" },
      });
    }
    try {
      if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
        throw new ConflictException({
          error: { code: "CHUNK_INDEX", message: "分片序号无效" },
        });
      }
      const expected = expectedChunkSize(session.fileSize, index, session.totalChunks);
      if (size !== expected) {
        throw new ConflictException({
          error: { code: "CHUNK_SIZE", message: "分片大小不正确" },
        });
      }
      if (size > CHUNK_SIZE) {
        throw new PayloadTooLargeException({
          error: { code: "CHUNK_TOO_LARGE", message: "分片超过 50MB" },
        });
      }
      const dest = path.join(session.dir, String(index));
      await fsp.rename(filePath, dest).catch(async () => {
        await fsp.copyFile(filePath, dest);
        await fsp.unlink(filePath).catch(() => undefined);
      });
      session.received.add(index);
      session.expiresAt = Date.now() + SESSION_TTL_MS;
      return {
        uploadId,
        index,
        received: session.received.size,
        totalChunks: session.totalChunks,
      };
    } catch (err) {
      await fsp.unlink(filePath).catch(() => undefined);
      throw err;
    }
  }

  async complete(actor: User, uploadId: string) {
    const session = this.take(actor, uploadId);
    if (session.received.size !== session.totalChunks) {
      throw new ConflictException({
        error: { code: "CHUNKS_INCOMPLETE", message: "分片未传完" },
      });
    }
    const result = await this.versions.storeMergedUpload(actor, {
      appId: session.appId,
      versionId: session.versionId,
      meta: session.meta,
      fileName: session.fileName,
      fileSize: session.fileSize,
      contentType: session.contentType,
      open: () => openChunks(session.dir, session.totalChunks),
    });
    this.sessions.delete(uploadId);
    await fsp.rm(session.dir, { recursive: true, force: true }).catch(() => undefined);
    return result;
  }

  async abort(actor: User, uploadId: string) {
    const session = this.sessions.get(uploadId);
    if (!session || session.actorId !== actor.id) {
      throw new NotFoundException({
        error: { code: "UPLOAD_NOT_FOUND", message: "上传会话不存在或已过期" },
      });
    }
    this.sessions.delete(uploadId);
    await fsp.rm(session.dir, { recursive: true, force: true }).catch(() => undefined);
    return { ok: true };
  }

  private async open(
    actor: User,
    appId: string,
    versionId: string | undefined,
    meta: UploadMeta,
    file: { fileName: string; fileSize: number; contentType?: string },
  ): Promise<ChunkSessionView> {
    this.sweep();
    const fileName = (file.fileName ?? "").trim();
    const fileSize = Number(file.fileSize);
    if (!fileName) {
      throw new ConflictException({
        error: { code: "FILE_REQUIRED", message: "缺少文件名" },
      });
    }
    if (!Number.isFinite(fileSize) || fileSize < 0) {
      throw new ConflictException({
        error: { code: "FILE_SIZE", message: "文件大小无效" },
      });
    }
    this.versions.assertAssetSize(fileSize);
    const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));
    const uploadId = randomUUID();
    const dir = path.join(os.tmpdir(), "appdock-chunks", uploadId);
    await fsp.mkdir(dir, { recursive: true });
    this.sessions.set(uploadId, {
      uploadId,
      actorId: actor.id,
      appId,
      versionId,
      meta,
      fileName,
      fileSize,
      totalChunks,
      contentType: file.contentType?.trim() || "application/octet-stream",
      dir,
      received: new Set(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return { uploadId, chunkSize: CHUNK_SIZE, fileSize, totalChunks, fileName };
  }

  private take(actor: User, uploadId: string): ChunkSession {
    this.sweep();
    const session = this.sessions.get(uploadId);
    if (!session || session.actorId !== actor.id) {
      throw new NotFoundException({
        error: { code: "UPLOAD_NOT_FOUND", message: "上传会话不存在或已过期" },
      });
    }
    return session;
  }

  private sweep() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt > now) continue;
      this.sessions.delete(id);
      void fsp.rm(session.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function expectedChunkSize(fileSize: number, index: number, totalChunks: number): number {
  if (fileSize === 0) return 0;
  if (index < totalChunks - 1) return CHUNK_SIZE;
  const rest = fileSize % CHUNK_SIZE;
  return rest === 0 ? CHUNK_SIZE : rest;
}

function openChunks(dir: string, total: number): Readable {
  if (total <= 0) return Readable.from([]);
  const files = Array.from({ length: total }, (_, i) => path.join(dir, String(i)));
  return Readable.from(chunkBodies(files));
}

async function* chunkBodies(files: string[]): AsyncGenerator<Buffer> {
  for (const file of files) {
    for await (const chunk of fs.createReadStream(file)) {
      yield chunk as Buffer;
    }
  }
}
