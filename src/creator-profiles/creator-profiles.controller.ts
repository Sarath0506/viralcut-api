import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CreatorProfilesService } from "./creator-profiles.service";
import { CreateCreatorProfileDto } from "./dto/creator-profile.dto";

@ApiTags("creator")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller("creator/profiles")
export class CreatorProfilesController {
  constructor(private readonly profiles: CreatorProfilesService) {}

  @Get()
  list(@CurrentUser() user: AuthJwtPayload) {
    return this.profiles.list(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: AuthJwtPayload,
    @Body() dto: CreateCreatorProfileDto,
  ) {
    return this.profiles.create(user.sub, dto);
  }

  @Patch(":id/default")
  setDefault(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.profiles.setDefault(user.sub, id);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.profiles.delete(user.sub, id);
  }
}
