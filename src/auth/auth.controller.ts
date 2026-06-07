import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";

import { CampaignInviteService } from "./campaign-invite.service";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";
import { AdminLoginDto } from "./dto/admin-auth.dto";
import { CampaignInviteAcceptDto } from "./dto/campaign-invite.dto";
import {
  BrandForgotPasswordDto,
  BrandLoginDto,
  BrandRegisterDto,
  BrandResetPasswordDto,
  RefreshTokenDto,
} from "./dto/brand-auth.dto";
import { CreatorOtpRequestDto, CreatorOtpVerifyDto } from "./dto/creator-auth.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly campaignInvites: CampaignInviteService,
    private readonly otp: OtpService,
  ) {}

  @Post("brand/register")
  @ApiOkResponse({ type: AuthResponseDto })
  registerBrand(@Body() dto: BrandRegisterDto) {
    return this.auth.registerBrand(dto);
  }

  @Post("brand/login")
  @ApiOkResponse({ type: AuthResponseDto })
  loginBrand(@Body() dto: BrandLoginDto) {
    return this.auth.loginBrand(dto);
  }

  @Post("admin/login")
  @ApiOkResponse({ type: AuthResponseDto })
  loginAdmin(@Body() dto: AdminLoginDto) {
    return this.auth.loginAdmin(dto);
  }

  @Post("brand/forgot-password")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() dto: BrandForgotPasswordDto) {
    return this.auth.forgotBrandPassword(dto.email);
  }

  @Post("brand/reset-password")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetPassword(@Body() dto: BrandResetPasswordDto) {
    return this.auth.resetBrandPassword(dto.token, dto.password);
  }

  @Get("campaign-invite/preview")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  previewCampaignInvite(@Query("token") token: string) {
    return this.campaignInvites.preview(token ?? "");
  }

  @Post("campaign-invite/accept")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  acceptCampaignInvite(@Body() dto: CampaignInviteAcceptDto) {
    return this.campaignInvites.accept(dto);
  }

  @Post("creator/otp/request")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestCreatorOtp(@Body() dto: CreatorOtpRequestDto) {
    return this.otp.requestOtp(dto.phone);
  }

  @Post("creator/otp/verify")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: AuthResponseDto })
  verifyCreatorOtp(@Body() dto: CreatorOtpVerifyDto) {
    return this.auth.verifyCreatorOtp(dto);
  }

  @Post("refresh")
  @ApiOkResponse({ type: AuthResponseDto })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post("logout")
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
