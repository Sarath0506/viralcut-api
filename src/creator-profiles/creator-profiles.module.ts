import { Module } from "@nestjs/common";

import { CreatorProfilesController } from "./creator-profiles.controller";
import { CreatorProfilesService } from "./creator-profiles.service";
import { ApifyService } from "../common/apify.service";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  controllers: [CreatorProfilesController],
  providers: [CreatorProfilesService, ApifyService],
  exports: [CreatorProfilesService],
})
export class CreatorProfilesModule {}
