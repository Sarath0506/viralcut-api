import {
  Body,
  Controller,
  Get,
  GoneException,
  Param,
  Patch,
  Post,
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
import { SubmissionsService } from "../submissions/submissions.service";

@ApiTags("creator")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller("creator")
export class CreatorSubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get("dashboard")
  dashboard(@CurrentUser() user: AuthJwtPayload) {
    return this.submissions.creatorDashboard(user.sub);
  }

  @Get("submissions")
  list(
    @CurrentUser() user: AuthJwtPayload,
    @Query("tab") tab?: "active" | "completed",
  ) {
    return this.submissions.listForCreator(user.sub, tab ?? "active");
  }

  @Get("submissions/:id")
  get(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.submissions.getForCreator(user.sub, id);
  }

  @Post("submissions")
  create() {
    throw new GoneException({
      code: "DEPRECATED",
      message:
        "Use POST /creator/campaigns/:campaignId/join and PATCH /creator/deliverables/:id/draft",
    });
  }

  @Patch("submissions/:id/live-link")
  submitLiveLink() {
    throw new GoneException({
      code: "DEPRECATED",
      message: "Use PATCH /creator/deliverables/:id/live-proof",
    });
  }

  @Patch("submissions/:id/sync-performance")
  syncPerformance(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() body: { views: number },
  ) {
    return this.submissions.syncPerformance(user.sub, id, body.views);
  }
}
