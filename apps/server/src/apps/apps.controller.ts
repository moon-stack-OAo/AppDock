import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { User } from "@prisma/client";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AppsService } from "./apps.service";
import { CreateAppDto } from "./dto/create-app.dto";
import { UpdateAppDto } from "./dto/update-app.dto";
import { UpsertMemberDto } from "./dto/upsert-member.dto";

@Controller("admin/apps")
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Get()
  list(@CurrentUser() actor: User) {
    return this.apps.list(actor);
  }

  @Post()
  create(@CurrentUser() actor: User, @Body() dto: CreateAppDto) {
    return this.apps.create(actor, dto);
  }

  @Get(":id/members")
  listMembers(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.apps.listMembers(actor, id);
  }

  @Put(":id/members")
  upsertMember(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body() dto: UpsertMemberDto,
  ) {
    return this.apps.upsertMember(actor, id, dto);
  }

  @Delete(":id/members/:userId")
  removeMember(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.apps.removeMember(actor, id, userId);
  }

  @Get(":id")
  get(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.apps.get(actor, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body() dto: UpdateAppDto,
  ) {
    return this.apps.update(actor, id, dto);
  }

  @Delete(":id")
  archive(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Query("purgeFiles") purgeFiles?: string,
  ) {
    return this.apps.archive(actor, id, purgeFiles === "true");
  }

  @Post(":id/unarchive")
  unarchive(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.apps.unarchive(actor, id);
  }
}
