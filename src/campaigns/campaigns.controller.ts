import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Get,
  UploadedFile,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { UserRole } from "@prisma/client";

import { imageOnlyFileFilter, imageOrVideoFileFilter } from "./campaign-upload.util";
import { ObjectStorageService } from "../storage/object-storage.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CampaignsService } from "./campaigns.service";
import { CreateCampaignDto, UpdateCampaignDto } from "./dto/campaign.dto";
import { ListCampaignsQueryDto } from "./dto/list-campaigns-query.dto";

@ApiTags("campaigns")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.brand, UserRole.agency)
@Controller("campaigns")
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly storage: ObjectStorageService,
  ) {}

  @Post("cover/upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 3 * 1024 * 1024 },
      fileFilter: imageOnlyFileFilter,
    }),
  )
  async uploadCoverImage(
    @UploadedFile()
    file:
      | { buffer: Buffer; originalname: string; mimetype: string }
      | undefined,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException("File is required");
    }
    return this.storage.saveUploadedFile("cover-images", file);
  }

  @Post("reference-assets/upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: imageOrVideoFileFilter,
    }),
  )
  async uploadReferenceAsset(
    @UploadedFile()
    file:
      | { buffer: Buffer; mimetype: string; originalname: string }
      | undefined,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException("File is required");
    }
    const type = file.mimetype.startsWith("image/") ? "image" : "video";
    return {
      ...(await this.storage.saveUploadedFile("reference-assets", file)),
      type,
    };
  }

  @Get()
  list(@CurrentUser() user: AuthJwtPayload, @Query() query: ListCampaignsQueryDto) {
    return this.campaigns.listForBrand(user.sub, user.role, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.campaigns.getForBrand(user.sub, user.role, id);
  }

  @Post()
  create(@CurrentUser() user: AuthJwtPayload, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(user.sub, user.role, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.update(user.sub, user.role, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    return this.campaigns.remove(user.sub, user.role, id);
  }
}
