import { Module } from "@nestjs/common";

import { AdminRolesModule } from "../admin-roles/admin-roles.module";
import { AuthModule } from "../auth/auth.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { FaqsModule } from "../faqs/faqs.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { StorageModule } from "../storage/storage.module";
import { SupportModule } from "../support/support.module";
import { WalletModule } from "../wallet/wallet.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [
    AdminRolesModule,
    AuthModule,
    CampaignsModule,
    FaqsModule,
    NotificationsModule,
    RealtimeModule,
    StorageModule,
    SupportModule,
    WalletModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
