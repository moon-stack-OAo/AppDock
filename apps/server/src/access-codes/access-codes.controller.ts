import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { User } from "@prisma/client";
import { UserRole } from "@appdock/shared";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { AccessCodesService } from "./access-codes.service";
import { CreateAccessCodeDto } from "./dto/create-access-code.dto";
import { UpdateAccessCodeDto } from "./dto/update-access-code.dto";

@Controller("admin/access-codes")
@Roles(UserRole.Admin)
export class AccessCodesController {
  constructor(private readonly codes: AccessCodesService) {}

  @Get()
  list(@Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.codes.list(Number(page) || 1, Number(pageSize) || 20);
  }

  @Post()
  create(@CurrentUser() actor: User, @Body() dto: CreateAccessCodeDto) {
    return this.codes.create(actor, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body() dto: UpdateAccessCodeDto,
  ) {
    return this.codes.update(actor, id, dto);
  }

  @Post(":id/rotate")
  rotate(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.codes.rotate(actor, id);
  }

  @Post(":id/reveal")
  reveal(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.codes.reveal(actor, id);
  }

  @Delete(":id")
  remove(@CurrentUser() actor: User, @Param("id") id: string) {
    return this.codes.disable(actor, id);
  }
}
