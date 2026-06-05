import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CampaignsService } from "../campaigns/campaigns.service";

@ApiTags("creator")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller("creator/campaigns")
export class CreatorCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  listLive() {
    return this.campaigns.listLiveForCreators();
  }

  @Get(":id")
  getLive(@Param("id") id: string) {
    return this.campaigns.getLiveForCreator(id);
  }
}
