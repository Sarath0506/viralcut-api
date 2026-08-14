import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CreateSupportTicketDto } from "./dto/support.dto";
import { SupportService } from "./support.service";

@ApiTags("support")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("support/tickets")
@Roles(UserRole.creator)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  createTicket(@CurrentUser() user: AuthJwtPayload, @Body() dto: CreateSupportTicketDto) {
    return this.support.createTicket(user.sub, dto);
  }

  @Get()
  listMyTickets(@CurrentUser() user: AuthJwtPayload) {
    return this.support.listMyTickets(user.sub);
  }
}
