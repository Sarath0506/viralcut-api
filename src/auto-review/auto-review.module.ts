import { Module } from "@nestjs/common";

import { ApifyService } from "../common/apify.service";
import { AutoReviewService } from "./auto-review.service";
import { ChecklistService } from "./checklist.service";
import { GeminiService } from "./gemini.service";

@Module({
  providers: [AutoReviewService, ApifyService, GeminiService, ChecklistService],
  exports: [AutoReviewService],
})
export class AutoReviewModule {}
