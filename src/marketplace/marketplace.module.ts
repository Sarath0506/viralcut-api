import { Module } from "@nestjs/common";

import { CreatorProfilesModule } from "../creator-profiles/creator-profiles.module";
import { ParticipationModule } from "../participation/participation.module";
import { MarketplaceService } from "./marketplace.service";

@Module({
  imports: [ParticipationModule, CreatorProfilesModule],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
