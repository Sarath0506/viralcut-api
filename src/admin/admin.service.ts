import { Injectable } from "@nestjs/common";
import { CampaignInviteStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import type { ListCampaignsQueryDto } from "../campaigns/dto/list-campaigns-query.dto";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
  ) {}

  async listBrands() {
    const brands = await this.prisma.brandProfile.findMany({
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        _count: { select: { campaigns: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return brands.map((b) => ({
      id: b.id,
      companyName: b.companyName,
      logoUrl: b.logoUrl,
      email: b.user.email,
      displayName: b.user.displayName,
      campaignCount: b._count.campaigns,
      createdAt: b.createdAt.toISOString(),
    }));
  }

  async listCampaigns(query: ListCampaignsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = query.status ? { status: query.status } : {};

    const [total, campaigns] = await this.prisma.$transaction([
      this.prisma.campaign.count({ where }),
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          brandProfile: { select: { id: true, companyName: true } },
          invites: {
            where: { status: CampaignInviteStatus.pending },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          _count: { select: { submissions: true } },
        },
      }),
    ]);

    return {
      items: campaigns.map((c) => ({
        ...this.campaigns.formatCampaign(c),
        brandCompanyName: c.brandProfile?.companyName ?? null,
        pendingInviteEmail: c.invites[0]?.email ?? null,
        submissionCount: c._count.submissions,
      })),
      total,
      page,
      limit,
    };
  }

  async getDashboardStats() {
    const [brandCount, campaignCount, pendingInvites] =
      await this.prisma.$transaction([
        this.prisma.brandProfile.count(),
        this.prisma.campaign.count(),
        this.prisma.campaignInvite.count({
          where: { status: CampaignInviteStatus.pending },
        }),
      ]);

    return { brandCount, campaignCount, pendingInvites };
  }
}
