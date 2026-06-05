import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";

import { BrandInviteService } from "./brand-invite.service";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp.service";
import {
  AgencyForgotPasswordDto,
  AgencyLoginDto,
  AgencyRegisterDto,
  AgencyResetPasswordDto,
} from "./dto/agency-auth.dto";
import { BrandInviteAcceptDto } from "./dto/brand-invite.dto";
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
    private readonly brandInvites: BrandInviteService,
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

  @Post("agency/register")
  @ApiOkResponse({ type: AuthResponseDto })
  registerAgency(@Body() dto: AgencyRegisterDto) {
    return this.auth.registerAgency(dto);
  }

  @Post("agency/login")
  @ApiOkResponse({ type: AuthResponseDto })
  loginAgency(@Body() dto: AgencyLoginDto) {
    return this.auth.loginAgency(dto);
  }

  @Post("agency/forgot-password")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotAgencyPassword(@Body() dto: AgencyForgotPasswordDto) {
    return this.auth.forgotAgencyPassword(dto.email);
  }

  @Post("agency/reset-password")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetAgencyPassword(@Body() dto: AgencyResetPasswordDto) {
    return this.auth.resetAgencyPassword(dto.token, dto.password);
  }

  @Get("brand-invite/preview")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  previewBrandInvite(@Query("token") token: string) {
    return this.brandInvites.preview(token ?? "");
  }

  @Post("brand-invite/accept")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  acceptBrandInvite(@Body() dto: BrandInviteAcceptDto) {
    return this.brandInvites.accept(dto);
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
