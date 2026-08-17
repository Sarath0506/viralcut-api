import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsBoolean, IsString, MaxLength, MinLength } from "class-validator";

export class SendBulkNotificationDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  recipientIds!: string[];

  @ApiProperty()
  @IsBoolean()
  usePush!: boolean;

  @ApiProperty()
  @IsBoolean()
  useWhatsapp!: boolean;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  message!: string;
}
