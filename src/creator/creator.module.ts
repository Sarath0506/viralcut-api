import { Module } from "@nestjs/common";

import { CampaignsModule } from "../campaigns/campaigns.module";
import { SubmissionsModule } from "../submissions/submissions.module";
import { CreatorCampaignsController } from "./creator-campaigns.controller";
import { CreatorSubmissionsController } from "./creator-submissions.controller";

@Module({
  imports: [CampaignsModule, SubmissionsModule],
  controllers: [CreatorCampaignsController, CreatorSubmissionsController],
})
export class CreatorModule {}
