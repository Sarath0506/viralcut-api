import { ApiProperty } from "@nestjs/swagger";

export class UserMeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  displayName!: string | null;

  @ApiProperty({ nullable: true })
  username!: string | null;

  @ApiProperty()
  kycStatus!: string;

  @ApiProperty({ nullable: true })
  companyName!: string | null;
}
