import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  ValidatorConstraintInterface,
} from "class-validator";

import { DRAFT_URL_MESSAGE, isValidDraftUrl } from "../drive-url";

@ValidatorConstraint({ name: "isValidDraftUrl", async: false })
class IsValidDraftUrlConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    return typeof value === "string" && isValidDraftUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return DRAFT_URL_MESSAGE;
  }
}

export class SubmitDraftDto {
  @ApiProperty({ example: "https://drive.google.com/file/d/abc/view" })
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  @Validate(IsValidDraftUrlConstraint)
  draftDriveUrl!: string;

  @ApiPropertyOptional({
    description:
      "List this clip in the campaign's marketplace once it's approved, so other clippers can repost it and split earnings with you. Only takes effect if draftDriveUrl is an app-uploaded file, not a Drive link.",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  listedInMarketplace?: boolean;
}
