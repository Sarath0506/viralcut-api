import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CampaignStatus, CampaignWizardStep } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

import { CAMPAIGN_PLATFORM_IDS } from "../campaign-platforms";

export class SourceAssetDto {
  @ApiProperty({ enum: ["drive", "youtube"] })
  @IsString()
  @IsIn(["drive", "youtube"])
  type!: "drive" | "youtube";

  @ApiProperty({ description: "Google Drive or YouTube URL" })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class ReferenceAssetDto {
  @ApiProperty({ enum: ["image", "video"] })
  @IsString()
  @IsIn(["image", "video"])
  type!: "image" | "video";

  @ApiProperty({ description: "Public URL or /uploads/... path from API upload" })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class CreateCampaignDto {
  @ApiPropertyOptional({ enum: CampaignWizardStep })
  @IsOptional()
  @IsEnum(CampaignWizardStep)
  wizardStep?: CampaignWizardStep;

  @ApiPropertyOptional({ enum: CampaignStatus, default: CampaignStatus.draft })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ default: "instagram_reel" })
  @IsOptional()
  @IsString()
  @IsIn([...CAMPAIGN_PLATFORM_IDS, "instagram_reels"])
  platform?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsIn([...CAMPAIGN_PLATFORM_IDS, "instagram_reels"], { each: true })
  platforms?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  briefHook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  doRules?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  avoidRules?: string;

  @ApiPropertyOptional({ type: [SourceAssetDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SourceAssetDto)
  sourceAssets?: SourceAssetDto[];

  @ApiPropertyOptional({ type: [ReferenceAssetDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReferenceAssetDto)
  referenceAssets?: ReferenceAssetDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  brief?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  productUrl?: string;

  @ApiPropertyOptional({ description: "Cover image URL from POST /campaigns/cover/upload" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: "₹ per 1K views in paise (5000 = ₹50)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  ratePer1kPaise?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  maxPayoutPaise?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  budgetPaise?: number;
}

export class UpdateCampaignDto {
  @ApiPropertyOptional({ enum: CampaignWizardStep })
  @IsOptional()
  @IsEnum(CampaignWizardStep)
  wizardStep?: CampaignWizardStep;

  @ApiPropertyOptional({ enum: CampaignStatus })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brief?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  briefHook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  doRules?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  avoidRules?: string;

  @ApiPropertyOptional({ type: [SourceAssetDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SourceAssetDto)
  sourceAssets?: SourceAssetDto[];

  @ApiPropertyOptional({ type: [ReferenceAssetDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReferenceAssetDto)
  referenceAssets?: ReferenceAssetDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsIn([...CAMPAIGN_PLATFORM_IDS, "instagram_reels"], { each: true })
  platforms?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  productUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: "₹ per 1K views in paise" })
  @IsOptional()
  @IsInt()
  @Min(1)
  ratePer1kPaise?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  maxPayoutPaise?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(100)
  budgetPaise?: number;
}

/** Lightweight wizard step save — wizardStep required, other fields optional. */
export class UpdateCampaignStepDto extends UpdateCampaignDto {
  @ApiProperty({ enum: CampaignWizardStep })
  @IsEnum(CampaignWizardStep)
  declare wizardStep: CampaignWizardStep;
}
