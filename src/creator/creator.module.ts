import { Module } from "@nestjs/common";

import { CampaignsModule } from "../campaigns/campaigns.module";
import { ParticipationModule } from "../participation/participation.module";
import { SubmissionsModule } from "../submissions/submissions.module";
import { CreatorCampaignsController } from "./creator-campaigns.controller";
import { CreatorParticipationController } from "./creator-participation.controller";
import { CreatorSubmissionsController } from "./creator-submissions.controller";

@Module({
  imports: [CampaignsModule, SubmissionsModule, ParticipationModule],
  controllers: [
    CreatorCampaignsController,
    CreatorParticipationController,
    CreatorSubmissionsController,
  ],
})
export class CreatorModule {}
