import { Module } from "@nestjs/common";

import { CampaignsModule } from "../campaigns/campaigns.module";
import { ParticipationModule } from "../participation/participation.module";
import { StorageModule } from "../storage/storage.module";
import { WalletModule } from "../wallet/wallet.module";
import { SubmissionsController } from "./submissions.controller";
import { SubmissionsService } from "./submissions.service";

@Module({
  imports: [CampaignsModule, ParticipationModule, WalletModule, StorageModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
