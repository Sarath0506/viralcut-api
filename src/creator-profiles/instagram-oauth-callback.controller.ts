import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";

import { InstagramOAuthService } from "./instagram-oauth.service";

@Controller("creator/profiles/social/instagram")
export class InstagramOAuthCallbackController {
  constructor(private readonly instagramOAuth: InstagramOAuthService) {}

  @Get("callback")
  async callback(
    @Query("state") state: string | undefined,
    @Query("code") code: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_reason") errorReason: string | undefined,
    @Res() res: Response,
  ) {
    const html = await this.instagramOAuth.callback({
      state,
      code,
      error,
      error_reason: errorReason,
    });
    res.type("html").send(html);
  }
}
