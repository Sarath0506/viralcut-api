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
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { SubmitDraftDto } from "../participation/dto/submit-draft.dto";
import { SubmitLiveProofDto } from "../participation/dto/submit-live-proof.dto";
import { ParticipationService } from "../participation/participation.service";

@ApiTags("creator")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller("creator")
export class CreatorParticipationController {
  constructor(private readonly participation: ParticipationService) {}

  @Get("participations")
  list(
    @CurrentUser() user: AuthJwtPayload,
    @Query("tab") tab?: "active" | "completed",
  ) {
    return this.participation.listForCreator(user.sub, tab ?? "active");
  }

  @Get("participations/:id")
  get(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.participation.getForCreator(user.sub, id);
  }

  @Patch("deliverables/:id/draft")
  submitDraft(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: SubmitDraftDto,
  ) {
    return this.participation.submitDraft(user.sub, id, dto);
  }

  @Patch("deliverables/:id/live-proof")
  submitLiveProof(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: SubmitLiveProofDto,
  ) {
    return this.participation.submitLiveProof(user.sub, id, dto);
  }
}
