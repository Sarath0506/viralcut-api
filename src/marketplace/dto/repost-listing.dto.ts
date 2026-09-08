import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class RepostListingDto {
  @ApiProperty({ example: "clh1a2b3c0000qzrmn831p4wg" })
  @IsString()
  @MinLength(1)
  creatorProfileId!: string;
}
