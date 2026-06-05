import type { UserRole } from "@prisma/client";

export interface AuthJwtPayload {
  sub: string;
  role: UserRole;
  email?: string | null;
  phone?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}
