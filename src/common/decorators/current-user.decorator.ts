import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import type { AuthJwtPayload } from "../../auth/auth.types";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthJwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthJwtPayload }>();
    return request.user;
  },
);
