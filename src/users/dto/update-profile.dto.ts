import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ example: "+919876543210" })
  @IsOptional()
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message: "Phone must be E.164 India format (+91XXXXXXXXXX)",
  })
  phone?: string;

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
