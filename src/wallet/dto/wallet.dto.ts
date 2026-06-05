import { ApiProperty } from "@nestjs/swagger";

export class WalletDto {
  @ApiProperty({ description: "Available balance in paise" })
  availablePaise!: number;

  @ApiProperty()
  pendingPaise!: number;

  @ApiProperty()
  lifetimePaise!: number;
}

export class TransactionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  amountPaise!: number;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty()
  createdAt!: string;
}
