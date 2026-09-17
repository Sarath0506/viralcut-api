import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module";
import { ParticipationModule } from "../participation/participation.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { StorageModule } from "../storage/storage.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { PublicCampaignsController } from "./public-campaigns.controller";

@Module({
  imports: [StorageModule, RealtimeModule, ParticipationModule, NotificationsModule],
  controllers: [CampaignsController, PublicCampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
