import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

import type { AuthJwtPayload } from "../../auth/auth.types";
import { AdminRolesService } from "../admin-roles.service";

/** Locks a route to Super Admins only (adminRoleId null) — used for the
 * Roles & Access endpoints themselves. Deliberately not expressible via
 * the AdminSection matrix, so no restricted role can ever grant access to
 * managing roles, including its own. */
@Injectable()
export class SuperAdminOnlyGuard implements CanActivate {
  constructor(private readonly adminRoles: AdminRolesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<{ user: AuthJwtPayload }>();
    if (!user) return true; // JwtAuthGuard already handles unauthenticated requests

    const permissions = await this.adminRoles.getEffectivePermissions(user.sub);
    if (!permissions.isSuperAdmin) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Only Super Admins can manage roles and access",
      });
    }
    return true;
  }
}
