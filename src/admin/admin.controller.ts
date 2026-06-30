import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

import { CampaignInviteService } from "../auth/campaign-invite.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { ListCampaignsQueryDto } from "../campaigns/dto/list-campaigns-query.dto";
import { ParticipationService } from "../participation/participation.service";
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
}

class RejectProofDto {
  reason!: string;
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
    private readonly participation: ParticipationService,
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

  // Proof approval endpoints — called by the brand/admin web dashboard
  @Post("deliverables/:id/approve-proof")
  approveProof(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
  ) {
    return this.participation.approveProof(user.sub, id);
  }

  @Post("deliverables/:id/reject-proof")
  rejectProof(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: RejectProofDto,
  ) {
    return this.participation.rejectProof(user.sub, id, dto.reason);
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
