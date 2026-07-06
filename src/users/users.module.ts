import { Module } from "@nestjs/common";

import { ApifyService } from "../common/apify.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { StorageModule } from "../storage/storage.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [StorageModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService, ApifyService],
  exports: [UsersService],
})
export class UsersModule {}
