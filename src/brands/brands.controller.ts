import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { BrandsService } from "./brands.service";

@ApiTags("brand")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.brand)
@Controller("brand")
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get("agency")
  getAgency(
    @CurrentUser() user: AuthJwtPayload,
    @Query("brandProfileId") brandProfileId?: string,
  ) {
    return this.brands.getLinkedAgency(user.sub, user.role, brandProfileId);
  }

  @Delete("agency")
  @HttpCode(HttpStatus.OK)
  revokeAgency(
    @CurrentUser() user: AuthJwtPayload,
    @Query("brandProfileId") brandProfileId?: string,
  ) {
    return this.brands.revokeAgency(user.sub, user.role, brandProfileId);
  }
}
