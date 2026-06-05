import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AgencyBrandStatus,
  BrandInviteStatus,
  BrandMembershipRole,
} from "@prisma/client";

import { BrandAccessService } from "../access/brand-access.service";
import { BrandInviteService } from "../auth/brand-invite.service";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateAgencyBrandDto } from "./dto/create-agency-brand.dto";

@Injectable()
export class AgenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
    private readonly brandInvites: BrandInviteService,
  ) {}

  async createBrandWorkspace(
    userId: string,
    dto: CreateAgencyBrandDto,
  ) {
    const agencyId = await this.brandAccess.getAgencyIdForUser(userId);

    const brandProfile = await this.prisma.brandProfile.create({
      data: {
        companyName: dto.companyName.trim(),
        agencyLink: {
          create: {
            agencyId,
            status: AgencyBrandStatus.active,
          },
        },
      },
      include: {
        agencyLink: { include: { agency: true } },
        invites: {
          where: { status: BrandInviteStatus.pending },
          take: 1,
        },
      },
    });

    let inviteSent = false;
    if (dto.contactEmail?.trim()) {
      await this.brandInvites.createAndSendInvite(
        agencyId,
        brandProfile.id,
        userId,
        dto.contactEmail,
      );
      inviteSent = true;
    }

    return {
      id: brandProfile.id,
      companyName: brandProfile.companyName,
      hasOwner: await this.brandHasOwner(brandProfile.id),
      inviteSent,
      agency: {
        id: brandProfile.agencyLink?.agency.id,
        companyName: brandProfile.agencyLink?.agency.companyName,
      },
    };
  }

  async listBrands(userId: string) {
    const agencyId = await this.brandAccess.getAgencyIdForUser(userId);

    const links = await this.prisma.agencyBrand.findMany({
      where: { agencyId, status: AgencyBrandStatus.active },
      include: {
        brandProfile: {
          include: {
            invites: {
              where: { status: BrandInviteStatus.pending },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            _count: { select: { campaigns: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(
      links.map(async (link) => ({
        brandProfileId: link.brandProfileId,
        companyName: link.brandProfile.companyName,
        hasOwner: await this.brandHasOwner(link.brandProfileId),
        campaignCount: link.brandProfile._count.campaigns,
        pendingInvite: link.brandProfile.invites[0]
          ? {
              email: link.brandProfile.invites[0].email,
              expiresAt: link.brandProfile.invites[0].expiresAt.toISOString(),
            }
          : null,
      })),
    );
  }

  private async brandHasOwner(brandProfileId: string): Promise<boolean> {
    const count = await this.prisma.brandMembership.count({
      where: { brandProfileId, role: BrandMembershipRole.owner },
    });
    return count > 0;
  }

  async getBrand(userId: string, brandProfileId: string) {
    const agencyId = await this.brandAccess.getAgencyIdForUser(userId);
    await this.brandAccess.assertAgencyManagesBrand(agencyId, brandProfileId);

    const profile = await this.prisma.brandProfile.findUnique({
      where: { id: brandProfileId },
      include: {
        invites: {
          where: { status: BrandInviteStatus.pending },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: { select: { campaigns: true, memberships: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Brand workspace not found",
      });
    }

    return {
      brandProfileId: profile.id,
      companyName: profile.companyName,
      logoUrl: profile.logoUrl,
      hasOwner: await this.brandHasOwner(profile.id),
      campaignCount: profile._count.campaigns,
      memberCount: profile._count.memberships,
      pendingInvite: profile.invites[0]
        ? {
            id: profile.invites[0].id,
            email: profile.invites[0].email,
            expiresAt: profile.invites[0].expiresAt.toISOString(),
          }
        : null,
    };
  }

  async sendInvite(
    userId: string,
    brandProfileId: string,
    email: string,
  ) {
    const agencyId = await this.brandAccess.getAgencyIdForUser(userId);
    await this.brandAccess.assertAgencyManagesBrand(agencyId, brandProfileId);
    return this.brandInvites.createAndSendInvite(
      agencyId,
      brandProfileId,
      userId,
      email,
    );
  }

  async revokeBrandLink(userId: string, brandProfileId: string) {
    const agencyId = await this.brandAccess.getAgencyIdForUser(userId);
    const link = await this.prisma.agencyBrand.findFirst({
      where: { agencyId, brandProfileId },
    });
    if (!link) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Brand link not found",
      });
    }

    await this.prisma.$transaction([
      this.prisma.agencyBrand.update({
        where: { id: link.id },
        data: { status: AgencyBrandStatus.revoked },
      }),
      this.prisma.brandInvite.updateMany({
        where: {
          brandProfileId,
          agencyId,
          status: BrandInviteStatus.pending,
        },
        data: { status: BrandInviteStatus.revoked },
      }),
    ]);

    return { revoked: true, brandProfileId };
  }
}
