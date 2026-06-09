import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsUrl,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  ValidatorConstraintInterface,
} from "class-validator";

import { GOOGLE_DRIVE_URL_MESSAGE, isGoogleDriveUrl } from "../drive-url";

@ValidatorConstraint({ name: "isGoogleDriveUrl", async: false })
class IsGoogleDriveUrlConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    return typeof value === "string" && isGoogleDriveUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return GOOGLE_DRIVE_URL_MESSAGE;
  }
}

export class SubmitDraftDto {
  @ApiProperty({ example: "https://drive.google.com/file/d/abc/view" })
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  @Validate(IsGoogleDriveUrlConstraint)
  draftDriveUrl!: string;
}
