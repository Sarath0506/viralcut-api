import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { RepostListingDto } from "../marketplace/dto/repost-listing.dto";
import { MarketplaceService } from "../marketplace/marketplace.service";

@ApiTags("creator")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller("creator")
export class CreatorMarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get("campaigns/:id/marketplace")
  browse(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Query("creatorProfileId") creatorProfileId: string,
  ) {
    return this.marketplace.listBrowsableListings(user.sub, id, creatorProfileId);
  }

  @Post("marketplace/listings/:id/repost")
  repost(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: RepostListingDto,
  ) {
    return this.marketplace.createRepost(user.sub, id, dto.creatorProfileId);
  }
}
