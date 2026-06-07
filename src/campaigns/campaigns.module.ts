import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module";
import { StorageModule } from "../storage/storage.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

@Module({
  imports: [StorageModule, RealtimeModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
