import {
  Body,
  Controller,
  Get,
  Param,
  Req,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { memoryStorage } from "multer";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { SubmitDraftDto } from "../participation/dto/submit-draft.dto";
import { SubmitLiveProofDto } from "../participation/dto/submit-live-proof.dto";
import { ParticipationService } from "../participation/participation.service";
import { ObjectStorageService } from "../storage/object-storage.service";

@ApiTags("creator")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller("creator")
export class CreatorParticipationController {
  constructor(
    private readonly participation: ParticipationService,
    private readonly storage: ObjectStorageService,
  ) {}

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

  @Post("deliverables/:id/upload-draft")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  async uploadDraftFile(
    @Req() req: import("express").Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.storage.saveUploadedFile("creator-drafts", {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
    // If the URL is a relative path (local disk, no R2), make it absolute
    const url = result.url.startsWith("http")
      ? result.url
      : `${req.protocol}://${req.get("host")}${result.url}`;
    return { url };
  }

  @Post("deliverables/:id/refresh-views")
  refreshViews(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
  ) {
    return this.participation.refreshDeliverableViews(user.sub, id);
  }
}
