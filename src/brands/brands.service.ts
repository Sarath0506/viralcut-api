import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AgencyBrandStatus,
  BrandInviteStatus,
  UserRole,
} from "@prisma/client";

import { BrandAccessService } from "../access/brand-access.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
  ) {}

  async getLinkedAgency(
    userId: string,
    role: UserRole,
    brandProfileId?: string,
  ) {
    const resolved = await this.brandAccess.resolveBrandProfileIdForMutation(
      userId,
      role,
      brandProfileId,
    );

    const link = await this.prisma.agencyBrand.findFirst({
      where: {
        brandProfileId: resolved,
        status: AgencyBrandStatus.active,
      },
      include: { agency: true },
    });

    if (!link) {
      return { agency: null };
    }

    return {
      agency: {
        id: link.agency.id,
        companyName: link.agency.companyName,
        linkedAt: link.createdAt.toISOString(),
      },
    };
  }

  async revokeAgency(
    userId: string,
    role: UserRole,
    brandProfileId?: string,
  ) {
    const resolvedBrandProfileId =
      await this.brandAccess.resolveBrandProfileIdForMutation(
        userId,
        role,
        brandProfileId,
      );
    const link = await this.prisma.agencyBrand.findFirst({
      where: {
        brandProfileId: resolvedBrandProfileId,
        status: AgencyBrandStatus.active,
      },
    });

    if (!link) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No agency linked to this brand",
      });
    }

    await this.prisma.$transaction([
      this.prisma.agencyBrand.update({
        where: { id: link.id },
        data: { status: AgencyBrandStatus.revoked },
      }),
      this.prisma.brandInvite.updateMany({
        where: {
          brandProfileId: resolvedBrandProfileId,
          agencyId: link.agencyId,
          status: BrandInviteStatus.pending,
        },
        data: { status: BrandInviteStatus.revoked },
      }),
    ]);

    return { revoked: true };
  }
}
