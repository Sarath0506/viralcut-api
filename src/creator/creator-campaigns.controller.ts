import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CampaignsService } from "../campaigns/campaigns.service";
import { ParticipationService } from "../participation/participation.service";

@ApiTags("creator")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller("creator/campaigns")
export class CreatorCampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly participation: ParticipationService,
  ) {}

  @Get()
  listLive() {
    return this.campaigns.listLiveForCreators();
  }

  @Get(":id")
  getLive(@Param("id") id: string) {
    return this.campaigns.getLiveForCreator(id);
  }

  @Post(":id/join")
  join(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.participation.joinCampaign(user.sub, id);
  }

  @Get(":id/participation")
  getParticipation(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
  ) {
    return this.participation.getParticipationByCampaign(user.sub, id);
  }
}
