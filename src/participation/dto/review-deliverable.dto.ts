import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export enum ReviewDeliverableAction {
  approve = "approve",
  reject = "reject",
}

export class ReviewDeliverableDto {
  @ApiProperty({ enum: ReviewDeliverableAction })
  @IsEnum(ReviewDeliverableAction)
  action!: ReviewDeliverableAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
