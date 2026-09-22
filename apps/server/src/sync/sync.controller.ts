import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { User } from "@prisma/client";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SyncService } from "./sync.service";
import { IsOptional, IsString, MaxLength } from "class-validator";

class ManualSyncDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tagName?: string;
}

@Controller()
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post("admin/apps/:id/sync")
  enqueue(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body() dto: ManualSyncDto,
  ) {
    return this.sync.enqueueManual(actor, id, dto.tagName);
  }

  @Get("admin/queue/summary")
  summary(@CurrentUser() actor: User) {
    return this.sync.queueSummary(actor);
  }

  @Get("admin/queue/jobs")
  list(
    @CurrentUser() actor: User,
    @Query("queue") queue?: string,
    @Query("status") status?: string,
    @Query("appId") appId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.sync.listJobs(actor, {
      queue,
      status,
      appId,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get("admin/sync-jobs")
  listAlias(
    @CurrentUser() actor: User,
    @Query("queue") queue?: string,
    @Query("status") status?: string,
    @Query("appId") appId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.sync.listJobs(actor, {
      queue,
      status,
      appId,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get("admin/queue/jobs/:jobId")
  get(@CurrentUser() actor: User, @Param("jobId") jobId: string) {
    return this.sync.getJob(actor, jobId);
  }

  @Post("admin/queue/jobs/:jobId/retry")
  retry(@CurrentUser() actor: User, @Param("jobId") jobId: string) {
    return this.sync.retry(actor, jobId);
  }
}
