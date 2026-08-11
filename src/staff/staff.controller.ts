import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CreateCampaignDto } from "../campaigns/dto/campaign.dto";
import { StaffService } from "./staff.service";

@ApiTags("staff")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.staff)
@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get("brands")
  getAssignedBrands(@CurrentUser() user: AuthJwtPayload) {
    return this.staff.getAssignedBrands(user.sub);
  }

  @Get("brands/:brandId")
  getBrand(@CurrentUser() user: AuthJwtPayload, @Param("brandId") brandId: string) {
    return this.staff.getBrand(user.sub, brandId);
  }

  @Post("brands/:brandId/campaigns")
  createCampaign(
    @CurrentUser() user: AuthJwtPayload,
    @Param("brandId") brandId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.staff.createCampaignForBrand(user.sub, brandId, dto);
  }
}
