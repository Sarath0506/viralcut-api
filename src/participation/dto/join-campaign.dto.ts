import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class JoinCampaignDto {
  @ApiProperty({ description: "Which of the creator's linked profiles is joining this campaign" })
  @IsString()
  creatorProfileId!: string;
}
