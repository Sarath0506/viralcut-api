import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
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

  @ApiProperty({ example: "Ravi Kumar", description: "Name on the bank account or UPI-linked account" })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  accountHolderName!: string;

  @ApiProperty({ description: "Full account number or UPI id — stored server-side, shown masked to the creator" })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  account!: string;

  @ApiPropertyOptional({ example: "HDFC0001234", description: "Required for bank accounts, ignored for UPI" })
  @ValidateIf((dto: CreatePayoutMethodDto) => dto.type === "bank")
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: "ifscCode must be a valid IFSC code (e.g. HDFC0001234)",
  })
  ifscCode?: string;

  @ApiPropertyOptional({ example: "HDFC Bank" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;
}

export class UpdatePayoutMethodDto {
  @ApiPropertyOptional({ example: "Ravi Kumar" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  accountHolderName?: string;

  @ApiPropertyOptional({ example: "HDFC0001234" })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: "ifscCode must be a valid IFSC code (e.g. HDFC0001234)",
  })
  ifscCode?: string;

  @ApiPropertyOptional({ example: "HDFC Bank" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: "HDFC Bank" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
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
  accountHolderName!: string;

  @ApiProperty()
  accountMasked!: string;

  @ApiPropertyOptional()
  ifscCode?: string | null;

  @ApiPropertyOptional()
  bankName?: string | null;

  @ApiProperty()
  isDefault!: boolean;
}

export class RevealPayoutMethodDto {
  @ApiProperty({ description: "Full, decrypted account number or UPI id" })
  accountNumber!: string;
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
