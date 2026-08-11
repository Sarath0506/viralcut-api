import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module";
import { EmailService } from "./email.service";
import { InAppNotificationController } from "./in-app-notification.controller";
import { InAppNotificationService } from "./in-app-notification.service";
import { PushNotificationService } from "./push-notification.service";
import { WhatsappService } from "./whatsapp.service";

@Module({
  imports: [RealtimeModule],
  controllers: [InAppNotificationController],
  providers: [WhatsappService, EmailService, InAppNotificationService, PushNotificationService],
  exports: [WhatsappService, EmailService, InAppNotificationService, PushNotificationService],
})
export class NotificationsModule {}
