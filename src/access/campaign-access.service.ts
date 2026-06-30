import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CampaignOwnership, UserRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CampaignAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getBrandProfileIdForUser(userId: string): Promise<string | null> {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  async assertCanAccessCampaign(
    userId: string,
    role: UserRole,
    campaign: {
      id: string;
      brandProfileId: string | null;
      ownership: CampaignOwnership;
    },
  ): Promise<void> {
    if (role === UserRole.admin) {
      return;
    }

    if (role === UserRole.brand) {
      const brandProfileId = await this.getBrandProfileIdForUser(userId);
      if (brandProfileId && campaign.brandProfileId === brandProfileId) {
        return;
      }
    }

    if (role === UserRole.staff && campaign.brandProfileId) {
      const assignment = await this.prisma.staffBrandAssignment.findUnique({
        where: {
          staffUserId_brandProfileId: {
            staffUserId: userId,
            brandProfileId: campaign.brandProfileId,
          },
        },
      });
      if (assignment) return;
    }

    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "No access to this campaign",
    });
  }

  async resolveBrandProfileIdForBrandCreate(
    userId: string,
    role: UserRole,
  ): Promise<string> {
    if (role !== UserRole.brand) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Brand profile required",
      });
    }

    const brandProfileId = await this.getBrandProfileIdForUser(userId);
    if (!brandProfileId) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Brand profile not found",
      });
    }
    return brandProfileId;
  }

  buildCampaignWhereForRole(
    role: UserRole,
    brandProfileId: string | null,
  ): Record<string, unknown> {
    if (role === UserRole.admin) {
      return {};
    }

    if (role === UserRole.brand && brandProfileId) {
      return { brandProfileId };
    }

    return { id: "__none__" };
  }
}
