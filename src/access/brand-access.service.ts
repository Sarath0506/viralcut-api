import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import {
  AgencyBrandStatus,
  UserRole,
} from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BrandAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async listAccessibleBrandProfileIds(
    userId: string,
    role: UserRole,
  ): Promise<string[]> {
    if (role === UserRole.brand) {
      const memberships = await this.prisma.brandMembership.findMany({
        where: { userId },
        select: { brandProfileId: true },
      });
      return memberships.map((m) => m.brandProfileId);
    }

    if (role === UserRole.agency) {
      const membership = await this.prisma.agencyMembership.findFirst({
        where: { userId },
        select: { agencyId: true },
      });
      if (!membership) {
        return [];
      }
      const links = await this.prisma.agencyBrand.findMany({
        where: {
          agencyId: membership.agencyId,
          status: AgencyBrandStatus.active,
        },
        select: { brandProfileId: true },
      });
      return links.map((l) => l.brandProfileId);
    }

    return [];
  }

  async assertCanAccessBrand(
    userId: string,
    role: UserRole,
    brandProfileId: string,
  ): Promise<void> {
    const allowed = await this.listAccessibleBrandProfileIds(userId, role);
    if (!allowed.includes(brandProfileId)) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "No access to this brand workspace",
      });
    }
  }

  async resolveBrandProfileIdForMutation(
    userId: string,
    role: UserRole,
    brandProfileId?: string,
  ): Promise<string> {
    if (role === UserRole.agency) {
      if (!brandProfileId) {
        throw new BadRequestException({
          code: "VALIDATION_ERROR",
          message: "brandProfileId is required for agency users",
        });
      }
      await this.assertCanAccessBrand(userId, role, brandProfileId);
      return brandProfileId;
    }

    if (brandProfileId) {
      await this.assertCanAccessBrand(userId, role, brandProfileId);
      return brandProfileId;
    }

    const ids = await this.listAccessibleBrandProfileIds(userId, role);
    if (ids.length === 0) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Brand profile required",
      });
    }
    if (ids.length > 1) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "brandProfileId is required when you belong to multiple brands",
      });
    }
    return ids[0]!;
  }

  async getAgencyIdForUser(userId: string): Promise<string> {
    const membership = await this.prisma.agencyMembership.findFirst({
      where: { userId },
      select: { agencyId: true },
    });
    if (!membership) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Agency membership required",
      });
    }
    return membership.agencyId;
  }

  async assertAgencyManagesBrand(
    agencyId: string,
    brandProfileId: string,
  ): Promise<void> {
    const link = await this.prisma.agencyBrand.findFirst({
      where: {
        agencyId,
        brandProfileId,
        status: AgencyBrandStatus.active,
      },
    });
    if (!link) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Agency does not manage this brand",
      });
    }
  }
}
