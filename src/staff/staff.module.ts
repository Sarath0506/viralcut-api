import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { StaffController } from "./staff.controller";
import { StaffService } from "./staff.service";

@Module({
  imports: [AuthModule, CampaignsModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
