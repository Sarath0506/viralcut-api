import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { WalletDto } from "./dto/wallet.dto";
import { WalletService } from "./wallet.service";

@ApiTags("wallet")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller("wallet")
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiOkResponse({ type: WalletDto })
  getWallet(@CurrentUser() user: AuthJwtPayload) {
    return this.wallet.getWallet(user.sub);
  }

  @Get("transactions")
  listTransactions(
    @CurrentUser() user: AuthJwtPayload,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const parsedLimit = Math.min(Number(limit) || 20, 50);
    return this.wallet.listTransactions(user.sub, parsedLimit, cursor);
  }
}
