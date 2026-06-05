import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreatePayoutMethodDto {
  @ApiProperty({ enum: ["bank", "upi"] })
  @IsString()
  type!: string;

  @ApiProperty({ example: "HDFC Bank" })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label!: string;

  @ApiProperty({ description: "Full account number or UPI id — stored masked server-side" })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  account!: string;
}

export class CreateWithdrawalDto {
  @ApiProperty({ description: "Amount in paise" })
  @IsInt()
  @Min(100)
  amountPaise!: number;

  @ApiProperty()
  @IsString()
  payoutMethodId!: string;

  @ApiPropertyOptional({ description: "Idempotency key to prevent duplicate withdrawals" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}

export class PayoutMethodDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  accountMasked!: string;

  @ApiProperty()
  isDefault!: boolean;
}

export class WithdrawalDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  amountPaise!: number;

  @ApiProperty()
  feePaise!: number;

  @ApiProperty()
  netPaise!: number;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  createdAt!: string;
}
