import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { User } from "@prisma/client";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { Public } from "./decorators/public.decorator";
import { AllowMustChangePassword } from "./decorators/allow-must-change-password.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import { REFRESH_COOKIE_NAME } from "./auth.constants";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(dto.login, dto.password, res);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    return this.authService.refresh(token, res);
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    return this.authService.logout(res);
  }

  @AllowMustChangePassword()
  @Get("me")
  me(@CurrentUser() user: User) {
    return this.authService.me(user);
  }

  @AllowMustChangePassword()
  @Post("change-password")
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.changePassword(
      user,
      dto.currentPassword,
      dto.newPassword,
      res,
    );
  }

  /** 测试用：需完整鉴权且受 mustChangePassword 拦截 */
  @Get("session-check")
  sessionCheck(@CurrentUser() user: User) {
    return {
      ok: true,
      userId: user.id,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
