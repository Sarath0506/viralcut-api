import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class AgencyRegisterDto {
  @ApiProperty({ example: "agency@company.in" })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: "Acme Media Agency" })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, { message: "You must accept the Terms of Service" })
  acceptTerms!: boolean;
}

export class AgencyLoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;
}

export class AgencyForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class AgencyResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
