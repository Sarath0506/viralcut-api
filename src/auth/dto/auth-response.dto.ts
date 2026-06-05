import { ApiProperty } from "@nestjs/swagger";

export class AuthTokensDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ example: "15m" })
  expiresIn!: string;
}

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ["creator", "brand", "admin"] })
  role!: string;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  displayName!: string | null;
}

export class AuthResponseDto {
  @ApiProperty({ type: AuthTokensDto })
  tokens!: AuthTokensDto;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}
