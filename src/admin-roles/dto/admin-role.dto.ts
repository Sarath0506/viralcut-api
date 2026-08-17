import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AdminPermissionLevel, AdminSection } from "@prisma/client";
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class CreateAdminRoleDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canSeeMoney?: boolean;
}

export class UpdateAdminRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canSeeMoney?: boolean;
}

class SectionPermissionInput {
  @ApiProperty({ enum: AdminSection })
  @IsEnum(AdminSection)
  section!: AdminSection;

  @ApiProperty({ enum: AdminPermissionLevel })
  @IsEnum(AdminPermissionLevel)
  level!: AdminPermissionLevel;
}

export class SetSectionPermissionsDto {
  @ApiProperty({ type: [SectionPermissionInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SectionPermissionInput)
  permissions!: SectionPermissionInput[];
}

export class AssignAdminRoleDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  adminRoleId?: string | null;
}
