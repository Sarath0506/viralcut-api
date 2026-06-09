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
