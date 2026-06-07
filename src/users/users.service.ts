import { NotFoundException, Injectable } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { brandProfile: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    const base = {
      id: user.id,
      role: user.role,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      username: user.username,
      kycStatus: user.kycStatus,
      companyName: user.brandProfile?.companyName ?? null,
    };

    if (role === UserRole.brand && user.brandProfile) {
      return {
        ...base,
        brandProfile: {
          id: user.brandProfile.id,
          companyName: user.brandProfile.companyName,
          logoUrl: user.brandProfile.logoUrl,
        },
      };
    }

    return base;
  }
}
