import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreatorOtpRequestDto {
  @ApiProperty({ example: "+919876543210" })
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message: "Phone must be E.164 India format (+91XXXXXXXXXX)",
  })
  phone!: string;
}

/** Accepts bare 10-digit Indian numbers as well as full +91 E.164 format. */
export class SendOtpDto {
  @ApiProperty({ example: "9876543210", description: "10-digit or +91 Indian mobile number" })
  @IsString()
  @Matches(/^(?:\+?91)?[6-9]\d{9}$/, {
    message: "Phone must be a valid Indian mobile number",
  })
  phone!: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: "9876543210", description: "10-digit or +91 Indian mobile number" })
  @IsString()
  @Matches(/^(?:\+?91)?[6-9]\d{9}$/, {
    message: "Phone must be a valid Indian mobile number",
  })
  phone!: string;

  @ApiProperty({ example: "123456" })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiPropertyOptional({ example: "Pragnatej" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ example: "pragnatej" })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/)
  username?: string;

  @ApiPropertyOptional({ example: "creator@example.com" })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}

export class CreatorOtpVerifyDto {
  @ApiProperty({ example: "+919876543210" })
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/)
  phone!: string;

  @ApiProperty({ example: "123456" })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiPropertyOptional({ example: "Pragnatej" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ example: "pragnatej" })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-z0-9_]+$/)
  username?: string;

  @ApiPropertyOptional({ example: "creator@example.com" })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
