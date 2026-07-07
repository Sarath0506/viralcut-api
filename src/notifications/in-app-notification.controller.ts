import { Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { InAppNotificationService } from "./in-app-notification.service";

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class InAppNotificationController {
  constructor(private readonly notifications: InAppNotificationService) {}

  @Get()
  list(@CurrentUser() user: AuthJwtPayload, @Query("unreadOnly") unreadOnly?: string) {
    return this.notifications.listForUser(user.sub, { unreadOnly: unreadOnly === "true" });
  }

  @Get("unread-count")
  async unreadCount(@CurrentUser() user: AuthJwtPayload) {
    return { count: await this.notifications.countUnread(user.sub) };
  }

  @Patch(":id/read")
  async markRead(@CurrentUser() user: AuthJwtPayload, @Param("id") id: string) {
    await this.notifications.markRead(user.sub, id);
    return { read: true };
  }

  @Patch("read-all")
  async markAllRead(@CurrentUser() user: AuthJwtPayload) {
    await this.notifications.markAllRead(user.sub);
    return { read: true };
  }
}
