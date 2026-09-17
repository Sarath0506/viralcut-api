import { Module } from "@nestjs/common";

import { ApifyService } from "../common/apify.service";
import { CreatorProfilesModule } from "../creator-profiles/creator-profiles.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AutoReviewService } from "./auto-review.service";
import { ChecklistService } from "./checklist.service";
import { GeminiService } from "./gemini.service";

@Module({
  imports: [RealtimeModule, NotificationsModule, CreatorProfilesModule],
  providers: [AutoReviewService, ApifyService, GeminiService, ChecklistService],
  exports: [AutoReviewService],
})
export class AutoReviewModule {}
