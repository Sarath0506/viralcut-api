import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUrl, MaxLength } from "class-validator";

export class SubmitLiveProofDto {
  @ApiProperty({ example: "https://www.instagram.com/reel/abc123/" })
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  livePostUrl!: string;
}
