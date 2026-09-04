import { Module } from "@nestjs/common";

import { ApifyService } from "../common/apify.service";
import { AutoReviewModule } from "../auto-review/auto-review.module";
import { CreatorProfilesModule } from "../creator-profiles/creator-profiles.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { ParticipationService } from "./participation.service";

@Module({
  imports: [RealtimeModule, NotificationsModule, CreatorProfilesModule, AutoReviewModule],
  providers: [ParticipationService, ApifyService],
  exports: [ParticipationService],
})
export class ParticipationModule {}
