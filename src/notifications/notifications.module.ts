import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module";
import { BulkNotificationService } from "./bulk-notification.service";
import { EmailService } from "./email.service";
import { InAppNotificationController } from "./in-app-notification.controller";
import { InAppNotificationService } from "./in-app-notification.service";
import { PushNotificationService } from "./push-notification.service";
import { WhatsappService } from "./whatsapp.service";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";

@Module({
  imports: [RealtimeModule],
  controllers: [InAppNotificationController, WhatsappWebhookController],
  providers: [
    WhatsappService,
    EmailService,
    InAppNotificationService,
    PushNotificationService,
    BulkNotificationService,
  ],
  exports: [
    WhatsappService,
    EmailService,
    InAppNotificationService,
    PushNotificationService,
    BulkNotificationService,
  ],
})
export class NotificationsModule {}
