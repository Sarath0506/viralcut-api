import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const PLATFORMS = ["instagram", "youtube", "twitter", "tiktok"] as const;

export class CreateCreatorProfileDto {
  @ApiProperty({ enum: PLATFORMS })
  @IsIn(PLATFORMS)
  platform!: string;

  @ApiProperty({ example: "myhandle", description: "Handle/username on that platform, without the @" })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  handle!: string;

  @ApiPropertyOptional({ example: "Meme page", description: "Optional nickname to tell profiles apart in the switcher" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}

export class CreatorProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  platform!: string;

  @ApiProperty()
  handle!: string;

  @ApiPropertyOptional()
  label?: string | null;

  @ApiPropertyOptional()
  avatarUrl?: string | null;

  @ApiProperty()
  isDefault!: boolean;
}
