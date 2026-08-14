import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateSupportTicketDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string;
}

export class ResolveSupportTicketDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  resolutionNote!: string;
}
