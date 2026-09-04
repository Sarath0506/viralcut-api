import { Module } from "@nestjs/common";

import { ApifyService } from "../common/apify.service";
import { AutoReviewService } from "./auto-review.service";

@Module({
  providers: [AutoReviewService, ApifyService],
  exports: [AutoReviewService],
})
export class AutoReviewModule {}
