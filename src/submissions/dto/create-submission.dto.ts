import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUrl } from "class-validator";

export class CreateSubmissionDto {
  @ApiProperty()
  @IsString()
  campaignId!: string;

  @ApiPropertyOptional({ default: "video" })
  @IsOptional()
  @IsString()
  mediaType?: string;

  @ApiProperty()
  @IsString()
  @IsUrl()
  draftDriveUrl!: string;
}

export class SubmitLiveLinkDto {
  @ApiProperty()
  @IsString()
  @IsUrl()
  liveReelUrl!: string;
}
