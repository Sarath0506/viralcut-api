import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SubmissionStatus, UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { ReviewSubmissionDto } from "./dto/review-submission.dto";
import { SubmissionsService } from "./submissions.service";

@ApiTags("submissions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.brand, UserRole.agency)
@Controller("submissions")
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get("stats")
  stats(
    @CurrentUser() user: AuthJwtPayload,
    @Query("brandProfileId") brandProfileId?: string,
  ) {
    return this.submissions.brandStats(user.sub, user.role, brandProfileId);
  }

  @Get()
  list(
    @CurrentUser() user: AuthJwtPayload,
    @Query("status") status?: SubmissionStatus,
    @Query("campaignId") campaignId?: string,
    @Query("brandProfileId") brandProfileId?: string,
  ) {
    return this.submissions.listForBrand(user.sub, user.role, {
      status,
      campaignId,
      brandProfileId,
    });
  }

  @Get(":id")
  get(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.submissions.getForBrand(user.sub, user.role, id);
  }

  @Patch(":id/review")
  review(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: ReviewSubmissionDto,
  ) {
    return this.submissions.review(user.sub, user.role, id, dto);
  }
}
