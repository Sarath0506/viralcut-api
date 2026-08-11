import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";

import { YoutubeOAuthService } from "./youtube-oauth.service";

@Controller("creator/profiles/social/youtube")
export class YoutubeOAuthCallbackController {
  constructor(private readonly youtubeOAuth: YoutubeOAuthService) {}

  @Get("callback")
  callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const html = this.youtubeOAuth.callback({ code, state, error });
    res.type("html").send(html);
  }
}
