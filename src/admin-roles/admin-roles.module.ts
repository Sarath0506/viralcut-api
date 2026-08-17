import { Module } from "@nestjs/common";

import { AdminRolesService } from "./admin-roles.service";
import { AdminSectionGuard } from "./guards/admin-section.guard";
import { SuperAdminOnlyGuard } from "./guards/super-admin-only.guard";

@Module({
  providers: [AdminRolesService, AdminSectionGuard, SuperAdminOnlyGuard],
  exports: [AdminRolesService, AdminSectionGuard, SuperAdminOnlyGuard],
})
export class AdminRolesModule {}
