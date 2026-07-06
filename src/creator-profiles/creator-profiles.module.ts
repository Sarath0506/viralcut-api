import { Module } from "@nestjs/common";

import { CreatorProfilesController } from "./creator-profiles.controller";
import { CreatorProfilesService } from "./creator-profiles.service";

@Module({
  controllers: [CreatorProfilesController],
  providers: [CreatorProfilesService],
  exports: [CreatorProfilesService],
})
export class CreatorProfilesModule {}
