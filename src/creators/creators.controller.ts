import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CreatorsService } from "./creators.service";

@ApiTags("creators")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.brand, UserRole.staff)
@Controller("creators")
export class CreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Get(":id")
  getCreator(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.creators.getCreatorProfile(id, user.sub, user.role);
  }
}
