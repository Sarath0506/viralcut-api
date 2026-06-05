import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export enum ReviewAction {
  approve = "approve",
  reject = "reject",
}

export class ReviewSubmissionDto {
  @ApiProperty({ enum: ReviewAction })
  @IsEnum(ReviewAction)
  action!: ReviewAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
