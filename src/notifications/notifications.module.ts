import { Module } from "@nestjs/common";

import { EmailService } from "./email.service";
import { WhatsappService } from "./whatsapp.service";

@Module({
  providers: [WhatsappService, EmailService],
  exports: [WhatsappService, EmailService],
})
export class NotificationsModule {}
