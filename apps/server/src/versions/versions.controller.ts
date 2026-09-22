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
  constructor(private readonly versions: VersionsService) {}

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
    storage: diskStorage({
      destination: os.tmpdir(),
      filename: (
        _req: unknown,
        file: { originalname: string },
        cb: (err: Error | null, name: string) => void,
      ) => {
        const safe = path.basename(file.originalname).replace(/[^\w.\-()+ ]+/g, "_");
        cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`);
      },
    }),
    limits: { fileSize: 1024 * 1024 * 1024, files: 20 },
  });
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
