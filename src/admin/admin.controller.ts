import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { IsEmail } from "class-validator";

import { CampaignInviteService } from "../auth/campaign-invite.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { ListCampaignsQueryDto } from "../campaigns/dto/list-campaigns-query.dto";
import { AdminService } from "./admin.service";

class SendCampaignInviteDto {
  @IsEmail()
  email!: string;
}

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly campaignInvites: CampaignInviteService,
  ) {}

  @Get("dashboard")
  getDashboard() {
    return this.admin.getDashboardStats();
  }

  @Get("brands")
  listBrands() {
    return this.admin.listBrands();
  }

  @Get("campaigns")
  listCampaigns(@Query() query: ListCampaignsQueryDto) {
    return this.admin.listCampaigns(query);
  }

  @Get("campaigns/:id/invites")
  listInvites(@Param("id") campaignId: string) {
    return this.campaignInvites.listInvites(campaignId);
  }

  @Post("campaigns/:id/invites")
  sendInvite(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") campaignId: string,
    @Body() dto: SendCampaignInviteDto,
  ) {
    return this.campaignInvites.sendInvite(user.sub, campaignId, dto.email);
  }

  @Delete("campaigns/:campaignId/invites/:inviteId")
  revokeInvite(
    @Param("campaignId") campaignId: string,
    @Param("inviteId") inviteId: string,
  ) {
    return this.campaignInvites.revokeInvite(campaignId, inviteId);
  }
}
