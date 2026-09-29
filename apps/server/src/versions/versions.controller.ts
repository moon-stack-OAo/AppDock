import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { User } from "@prisma/client";
import { diskStorage } from "multer";
import * as os from "os";
import * as path from "path";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ChunkUploadService } from "./chunk-upload.service";
import { VersionsService } from "./versions.service";

type Uploaded = {
  path: string;
  originalname: string;
  size: number;
  mimetype: string;
};

function parseList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* 单值 */
  }
  return [value];
}

function truthy(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

@Controller()
export class VersionsController {
  constructor(
    private readonly versions: VersionsService,
    private readonly chunks: ChunkUploadService,
  ) {}

  @Get("admin/apps/:id/versions")
  list(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.versions.list(actor, id);
  }

  @Post("admin/apps/:id/versions")
  create(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body() body: { tagName: string; name?: string; body?: string; isPrerelease?: boolean; publishedAt?: string },
  ) {
    return this.versions.createMeta(actor, id, body);
  }

  @Post("admin/apps/:id/versions/upload")
  @UseInterceptors(uploadInterceptor())
  uploadVersion(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @UploadedFiles() files: Uploaded[] | undefined,
    @Body() body: Record<string, string>,
  ) {
    return this.versions.uploadNewVersion(actor, id, toMeta(body), toIncoming(files));
  }

  @Post("admin/versions/:versionId/assets/upload")
  @UseInterceptors(uploadInterceptor())
  uploadAssets(
    @CurrentUser() actor: User,
    @Param("versionId") versionId: string,
    @UploadedFiles() files: Uploaded[] | undefined,
    @Body() body: Record<string, string>,
  ) {
    return this.versions.uploadAssets(actor, versionId, toMeta(body), toIncoming(files));
  }

  @Post("admin/apps/:id/versions/upload/init")
  initVersionUpload(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body() body: Record<string, string>,
  ) {
    return this.chunks.initNewVersion(actor, id, toMeta(body), toChunkFile(body));
  }

  @Post("admin/versions/:versionId/assets/upload/init")
  initAssetsUpload(
    @CurrentUser() actor: User,
    @Param("versionId") versionId: string,
    @Body() body: Record<string, string>,
  ) {
    return this.chunks.initAssets(actor, versionId, toMeta(body), toChunkFile(body));
  }

  @Post("admin/uploads/:uploadId/chunks")
  @UseInterceptors(chunkInterceptor())
  putChunk(
    @CurrentUser() actor: User,
    @Param("uploadId") uploadId: string,
    @UploadedFiles() files: Uploaded[] | undefined,
    @Body() body: Record<string, string>,
  ) {
    const file = files?.[0];
    if (!file) {
      return this.chunks.putChunk(actor, uploadId, Number(body.index), "", -1);
    }
    return this.chunks.putChunk(actor, uploadId, Number(body.index), file.path, file.size);
  }

  @Post("admin/uploads/:uploadId/complete")
  completeUpload(@CurrentUser() actor: User, @Param("uploadId") uploadId: string) {
    return this.chunks.complete(actor, uploadId);
  }

  @Delete("admin/uploads/:uploadId")
  abortUpload(@CurrentUser() actor: User, @Param("uploadId") uploadId: string) {
    return this.chunks.abort(actor, uploadId);
  }

  @Post("admin/versions/:versionId/yank")
  yank(@CurrentUser() actor: User, @Param("versionId") versionId: string) {
    return this.versions.yank(actor, versionId);
  }

  @Delete("admin/assets/:assetId")
  removeAsset(@CurrentUser() actor: User, @Param("assetId") assetId: string) {
    return this.versions.deleteAsset(actor, assetId);
  }
}

function uploadInterceptor() {
  return FilesInterceptor("files", 20, {
    storage: tmpDisk(),
    limits: { fileSize: 1024 * 1024 * 1024, files: 20 },
  });
}

function chunkInterceptor() {
  return FilesInterceptor("chunk", 1, {
    storage: tmpDisk(),
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });
}

function tmpDisk() {
  return diskStorage({
    destination: os.tmpdir(),
    filename: (
      _req: unknown,
      file: { originalname: string },
      cb: (err: Error | null, name: string) => void,
    ) => {
      const safe = path.basename(file.originalname).replace(/[^\w.\-()+ ]+/g, "_");
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`);
    },
  });
}

function toChunkFile(body: Record<string, string>) {
  return {
    fileName: body.fileName ?? "",
    fileSize: Number(body.fileSize),
    contentType: body.contentType,
  };
}

function toIncoming(files: Uploaded[] | undefined) {
  return (files ?? []).map((file) => ({
    path: file.path,
    originalName: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
  }));
}

function toMeta(body: Record<string, string>) {
  return {
    tagName: body.tagName,
    name: body.name,
    body: body.body,
    isPrerelease: truthy(body.isPrerelease),
    overwrite: truthy(body.overwrite),
    platform: body.platform,
    arch: body.arch,
    platforms: parseList(body.platforms),
    arches: parseList(body.arches),
  };
}
