import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@prisma/client";

import { ROLES_KEY } from "../decorators/roles.decorator";
import type { AuthJwtPayload } from "../../auth/auth.types";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user: AuthJwtPayload }>();
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You do not have access to this resource",
      });
    }
    return true;
  }
}
