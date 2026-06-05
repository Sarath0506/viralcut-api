import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import {
  CreatePayoutMethodDto,
  CreateWithdrawalDto,
  PayoutMethodDto,
  WithdrawalDto,
} from "./dto/payout.dto";
import { PayoutsService } from "./payouts.service";

@ApiTags("payouts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.creator)
@Controller()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get("payout-methods")
  listMethods(@CurrentUser() user: AuthJwtPayload) {
    return this.payouts.listPayoutMethods(user.sub);
  }

  @Post("payout-methods")
  @ApiOkResponse({ type: PayoutMethodDto })
  createMethod(
    @CurrentUser() user: AuthJwtPayload,
    @Body() dto: CreatePayoutMethodDto,
  ) {
    return this.payouts.createPayoutMethod(user.sub, dto);
  }

  @Patch("payout-methods/:id/default")
  setDefault(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
  ) {
    return this.payouts.setDefaultPayoutMethod(user.sub, id);
  }

  @Delete("payout-methods/:id")
  deleteMethod(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
  ) {
    return this.payouts.deletePayoutMethod(user.sub, id);
  }

  @Post("withdrawals")
  @ApiOkResponse({ type: WithdrawalDto })
  withdraw(
    @CurrentUser() user: AuthJwtPayload,
    @Body() dto: CreateWithdrawalDto,
  ) {
    return this.payouts.createWithdrawal(user.sub, dto);
  }

  @Get("withdrawals")
  listWithdrawals(
    @CurrentUser() user: AuthJwtPayload,
    @Query("limit") limit?: string,
  ) {
    return this.payouts.listWithdrawals(
      user.sub,
      Math.min(Number(limit) || 20, 50),
    );
  }
}
