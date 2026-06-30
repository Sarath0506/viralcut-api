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
import {
  FormatDeliverableStatus,
  SubmissionStatus,
  UserRole,
} from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { ReviewDeliverableDto } from "../participation/dto/review-deliverable.dto";
import { ParticipationService } from "../participation/participation.service";
import { ReviewSubmissionDto } from "./dto/review-submission.dto";
import { SubmissionsService } from "./submissions.service";

@ApiTags("submissions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.brand, UserRole.admin, UserRole.staff)
@Controller("submissions")
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly participation: ParticipationService,
  ) {}

  @Get("stats")
  stats(@CurrentUser() user: AuthJwtPayload) {
    return this.submissions.brandStats(user.sub, user.role);
  }

  @Get()
  list(
    @CurrentUser() user: AuthJwtPayload,
    @Query("status") status?: SubmissionStatus,
    @Query("campaignId") campaignId?: string,
  ) {
    return this.submissions.listForBrand(user.sub, user.role, {
      status,
      campaignId,
    });
  }

  /** Per-format deliverables — must be registered before `:id` routes. */
  @Get("deliverables")
  listDeliverables(
    @CurrentUser() user: AuthJwtPayload,
    @Query("status") status?: FormatDeliverableStatus,
    @Query("campaignId") campaignId?: string,
  ) {
    return this.participation.listDeliverablesForBrand(user.sub, user.role, {
      status,
      campaignId,
    });
  }

  @Get("deliverables/:id")
  getDeliverable(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.participation.getDeliverableForBrand(user.sub, user.role, id);
  }

  @Patch("deliverables/:id/review")
  reviewDeliverable(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: ReviewDeliverableDto,
  ) {
    return this.participation.reviewDeliverable(
      user.sub,
      user.role,
      id,
      dto.action,
      dto.rejectionReason,
    );
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
