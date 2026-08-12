import { Controller, Get, Logger, Post, Query, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";

/**
 * Meta Cloud API webhook handshake — required to activate a WhatsApp
 * Business number. GET verifies ownership via a shared token; POST is a
 * placeholder that just logs incoming events until real handling is built.
 */
@ApiExcludeController()
@Controller("webhook/whatsapp")
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  @Get()
  verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
    @Res() res: Response,
  ) {
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Verification failed");
  }

  @Post()
  receive(@Req() req: Request, @Res() res: Response) {
    this.logger.log(`WhatsApp webhook event: ${JSON.stringify(req.body)}`);
    res.status(200).send("OK");
  }
}
