import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { SendBrandInviteDto } from "../auth/dto/brand-invite.dto";
import { AgenciesService } from "./agencies.service";
import { CreateAgencyBrandDto } from "./dto/create-agency-brand.dto";

@ApiTags("agency")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.agency)
@Controller("agency/brands")
export class AgenciesController {
  constructor(private readonly agencies: AgenciesService) {}

  @Post()
  create(
    @CurrentUser() user: AuthJwtPayload,
    @Body() dto: CreateAgencyBrandDto,
  ) {
    return this.agencies.createBrandWorkspace(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthJwtPayload) {
    return this.agencies.listBrands(user.sub);
  }

  @Get(":brandProfileId")
  get(
    @CurrentUser() user: AuthJwtPayload,
    @Param("brandProfileId") brandProfileId: string,
  ) {
    return this.agencies.getBrand(user.sub, brandProfileId);
  }

  @Post(":brandProfileId/invites")
  @HttpCode(HttpStatus.OK)
  invite(
    @CurrentUser() user: AuthJwtPayload,
    @Param("brandProfileId") brandProfileId: string,
    @Body() dto: SendBrandInviteDto,
  ) {
    return this.agencies.sendInvite(user.sub, brandProfileId, dto.email);
  }

  @Delete(":brandProfileId/link")
  @HttpCode(HttpStatus.OK)
  revokeLink(
    @CurrentUser() user: AuthJwtPayload,
    @Param("brandProfileId") brandProfileId: string,
  ) {
    return this.agencies.revokeBrandLink(user.sub, brandProfileId);
  }
}
