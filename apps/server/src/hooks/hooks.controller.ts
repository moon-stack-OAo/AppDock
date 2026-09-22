import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { HooksService } from "./hooks.service";
import { verifyGithubSignature } from "./github-webhook.util";

type RawRequest = Request & { rawBody?: Buffer };

const NOT_IMPLEMENTED = {
  error: {
    code: "PROVIDER_NOT_IMPLEMENTED",
    message: "该 Provider 同步尚未实现",
  },
};

@Controller("hooks")
export class HooksController {
  constructor(
    private readonly hooks: HooksService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post("github")
  @HttpCode(200)
  github(
    @Req() req: RawRequest,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Headers("x-github-event") event: string | undefined,
  ) {
    const secret = this.config.get<string>("APPDOCK_WEBHOOK_SECRET") ?? "";
    const raw = req.rawBody;
    if (!raw || !verifyGithubSignature(raw, signature, secret)) {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "Webhook 签名无效" },
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new UnauthorizedException({
        error: { code: "UNAUTHORIZED", message: "Webhook 正文无效" },
      });
    }
    return this.hooks.handleGithub(event, payload);
  }

  @Public()
  @Post("gitee")
  @HttpCode(501)
  gitee() {
    return NOT_IMPLEMENTED;
  }

  @Public()
  @Post("gitlab")
  @HttpCode(501)
  gitlab() {
    return NOT_IMPLEMENTED;
  }
}
