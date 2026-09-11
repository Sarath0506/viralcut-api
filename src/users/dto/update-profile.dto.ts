import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  // phone is intentionally not editable here — it's the OTP-verified login
  // identity, and this endpoint has no re-verification step. Changing it
  // needs its own OTP-gated flow, not a field on the general profile form.

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: "Map of social platform to profile URL, e.g. { instagram, twitter, linkedin, youtube, website }",
  })
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;
}

export class ChangePasswordDto {
  @ApiPropertyOptional()
  @IsString()
  currentPassword!: string;

  @ApiPropertyOptional({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
