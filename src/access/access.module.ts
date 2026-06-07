import { Global, Module } from "@nestjs/common";

import { CampaignAccessService } from "./campaign-access.service";

@Global()
@Module({
  providers: [CampaignAccessService],
  exports: [CampaignAccessService],
})
export class AccessModule {}
