import { NotFoundException, BadRequestException, Injectable } from "@nestjs/common";
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

  async updateBrandProfile(
    userId: string,
    data: { companyName?: string; displayName?: string; logoUrl?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { brandProfile: true },
    });
    if (!user?.brandProfile) {
      throw new BadRequestException({ code: "FORBIDDEN", message: "No brand profile found" });
    }

    const [updatedProfile, updatedUser] = await this.prisma.$transaction([
      this.prisma.brandProfile.update({
        where: { id: user.brandProfile.id },
        data: {
          ...(data.companyName !== undefined && { companyName: data.companyName }),
          ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(data.displayName !== undefined && { displayName: data.displayName }),
        },
      }),
    ]);

    return {
      companyName: updatedProfile.companyName,
      logoUrl: updatedProfile.logoUrl,
      displayName: updatedUser.displayName,
    };
  }
}
