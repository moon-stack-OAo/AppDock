import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { User } from "@prisma/client";
import { UserRole } from "@appdock/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Controller("admin/users")
@Roles(UserRole.Admin)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.listPublic();
  }

  @Post()
  create(@CurrentUser() actor: User, @Body() dto: CreateUserDto) {
    return this.users.createByAdmin(actor, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() actor: User,
    @Param("id") id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.updateByAdmin(actor, id, dto);
  }
}
