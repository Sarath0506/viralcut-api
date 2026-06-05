import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class BrandInviteAcceptDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;

  @ApiPropertyOptional({ minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}

export class SendBrandInviteDto {
  @ApiProperty({ example: "owner@brand.in" })
  @IsEmail()
  email!: string;
}
