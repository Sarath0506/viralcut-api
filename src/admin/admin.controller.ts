import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import { memoryStorage } from "multer";

import { CampaignInviteService } from "../auth/campaign-invite.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { ListCampaignsQueryDto } from "../campaigns/dto/list-campaigns-query.dto";
import { ObjectStorageService } from "../storage/object-storage.service";
import { AdminService } from "./admin.service";


class SendCampaignInviteDto {
  @IsEmail()
  email!: string;
}

class CreateBrandDto {
  @IsString()
  companyName!: string;

  @IsEmail()
  companyEmail!: string;

  @IsOptional()
  @IsString()
  pocName?: string;

  @IsOptional()
  @IsString()
  pocPhone?: string;

  @IsOptional()
  @IsEmail()
  pocEmail?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}

class CreateTeamMemberDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly campaignInvites: CampaignInviteService,
    private readonly storage: ObjectStorageService,
  ) {}

  @Get("dashboard")
  getDashboard() {
    return this.admin.getDashboardStats();
  }

  @Get("brands")
  listBrands() {
    return this.admin.listBrands();
  }

  @Post("brands")
  createBrand(@Body() dto: CreateBrandDto) {
    return this.admin.createBrand(dto);
  }

  @Post("brand-logo")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadBrandLogo(
    @Req() req: import("express").Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.storage.saveUploadedFile("brand-logos", {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
    const url = result.url.startsWith("http")
      ? result.url
      : `${req.protocol}://${req.get("host")}${result.url}`;
    return { url };
  }

  @Get("brands/:id")
  getBrand(@Param("id") id: string) {
    return this.admin.getBrand(id);
  }

  @Get("campaigns")
  listCampaigns(@Query() query: ListCampaignsQueryDto) {
    return this.admin.listCampaigns(query);
  }

  @Get("campaigns/:id/invites")
  listInvites(@Param("id") campaignId: string) {
    return this.campaignInvites.listInvites(campaignId);
  }

  @Post("campaigns/:id/invites")
  sendInvite(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") campaignId: string,
    @Body() dto: SendCampaignInviteDto,
  ) {
    return this.campaignInvites.sendInvite(user.sub, campaignId, dto.email);
  }

  @Delete("campaigns/:campaignId/invites/:inviteId")
  revokeInvite(
    @Param("campaignId") campaignId: string,
    @Param("inviteId") inviteId: string,
  ) {
    return this.campaignInvites.revokeInvite(campaignId, inviteId);
  }

  @Get("team-members")
  listTeamMembers() {
    return this.admin.listTeamMembers();
  }

  @Post("team-members")
  createTeamMember(@Body() dto: CreateTeamMemberDto) {
    return this.admin.createTeamMember(dto);
  }

  @Post("team-members/:staffId/brands/:brandId")
  assignBrand(@Param("staffId") staffId: string, @Param("brandId") brandId: string) {
    return this.admin.assignBrandToStaff(staffId, brandId);
  }

  @Delete("team-members/:staffId/brands/:brandId")
  removeBrand(@Param("staffId") staffId: string, @Param("brandId") brandId: string) {
    return this.admin.removeBrandFromStaff(staffId, brandId);
  }
}
