import { SetMetadata } from "@nestjs/common";
import type { AdminSection } from "@prisma/client";

export const ADMIN_SECTION_KEY = "adminSection";

/** Marks a route as belonging to an admin panel section, so
 * AdminSectionGuard can require View (GET) or Manage (writes) on it. */
export const AdminSectionRoute = (section: AdminSection) => SetMetadata(ADMIN_SECTION_KEY, section);
