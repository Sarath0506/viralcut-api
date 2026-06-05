import { NotFoundException, Injectable } from "@nestjs/common";
import {
  AgencyBrandStatus,
  BrandInviteStatus,
  BrandMembershipRole,
  UserRole,
} from "@prisma/client";

import { BrandAccessService } from "../access/brand-access.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
  ) {}

  async getMe(userId: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: true,
        agencyMemberships: { include: { agency: true } },
        brandMemberships: { include: { brandProfile: true } },
      },
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

    if (role === UserRole.agency) {
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
              memberships: {
                where: { role: BrandMembershipRole.owner },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const agency = user.agencyMemberships[0]?.agency;
      return {
        ...base,
        agency: agency
          ? { id: agency.id, companyName: agency.companyName }
          : null,
        managedBrands: links.map((link) => ({
          brandProfileId: link.brandProfileId,
          companyName: link.brandProfile.companyName,
          hasOwner: link.brandProfile.memberships.length > 0,
          inviteStatus: link.brandProfile.invites[0]?.status ?? null,
        })),
      };
    }

    if (role === UserRole.brand) {
      const allMemberships = await Promise.all(
        user.brandMemberships.map(async (membership) => {
          const link = await this.prisma.agencyBrand.findFirst({
            where: {
              brandProfileId: membership.brandProfileId,
              status: AgencyBrandStatus.active,
            },
            include: { agency: true },
          });
          return {
            brandProfileId: membership.brandProfileId,
            companyName: membership.brandProfile.companyName,
            linkedAgency: link
              ? {
                  id: link.agency.id,
                  companyName: link.agency.companyName,
                }
              : null,
          };
        }),
      );

      // Brand portal: only the brand's own workspace(s), not agency-managed ones.
      const workspaces = allMemberships.filter((w) => !w.linkedAgency);
      const agencyConnections = allMemberships
        .filter((w) => w.linkedAgency)
        .map((w) => ({
          brandProfileId: w.brandProfileId,
          companyName: w.companyName,
          agency: w.linkedAgency!,
        }));

      const primary =
        workspaces[0] ??
        (user.brandProfile
          ? {
              brandProfileId: user.brandProfile.id,
              companyName: user.brandProfile.companyName,
              linkedAgency: null as null,
            }
          : null);

      return {
        ...base,
        workspaces,
        agencyConnections,
        brandProfile: primary
          ? {
              id: primary.brandProfileId,
              companyName: primary.companyName,
            }
          : null,
        linkedAgency: agencyConnections[0]?.agency ?? null,
      };
    }

    return base;
  }
}
