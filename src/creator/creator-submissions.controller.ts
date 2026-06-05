import {
  Body,
  Controller,
  Get,
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
import {
  CreateSubmissionDto,
  SubmitLiveLinkDto,
} from "../submissions/dto/create-submission.dto";
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
  create(
    @CurrentUser() user: AuthJwtPayload,
    @Body() dto: CreateSubmissionDto,
  ) {
    return this.submissions.createForCreator(user.sub, dto);
  }

  @Patch("submissions/:id/live-link")
  submitLiveLink(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: SubmitLiveLinkDto,
  ) {
    return this.submissions.submitLiveLink(user.sub, id, dto);
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
