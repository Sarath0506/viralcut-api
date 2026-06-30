import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CampaignInviteStatus, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";

import { PrismaService } from "../prisma/prisma.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { EmailService } from "../notifications/email.service";
import type { ListCampaignsQueryDto } from "../campaigns/dto/list-campaigns-query.dto";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly email: EmailService,
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

  async createBrand(dto: {
    companyName: string;
    companyEmail: string;
    pocName?: string;
    pocPhone?: string;
    pocEmail?: string;
  }) {
    const loginEmail = dto.companyEmail.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: loginEmail } });
    if (existing) {
      throw new ConflictException({ code: "CONFLICT", message: "Email already registered" });
    }
    const rawPassword = `ViralCut@${Math.random().toString(36).slice(2, 10)}`;
    const passwordHash = await bcrypt.hash(rawPassword, 12);
    const user = await this.prisma.user.create({
      data: {
        role: UserRole.brand,
        email: loginEmail,
        passwordHash,
        displayName: dto.pocName?.trim() || dto.companyName.trim(),
        termsAcceptedAt: new Date(),
      },
    });
    await this.prisma.$transaction([
      this.prisma.brandProfile.create({
        data: {
          userId: user.id,
          companyName: dto.companyName.trim(),
          companyEmail: loginEmail,
          pocName: dto.pocName?.trim() || null,
          pocPhone: dto.pocPhone?.trim() || null,
          pocEmail: dto.pocEmail?.trim() || null,
        },
      }),
      this.prisma.wallet.create({ data: { userId: user.id } }),
    ]);
    const brand = await this.prisma.brandProfile.findUnique({
      where: { userId: user.id },
      include: { user: { select: { email: true, displayName: true } }, _count: { select: { campaigns: true } } },
    });
    return {
      id: brand!.id,
      companyName: brand!.companyName,
      companyEmail: brand!.companyEmail,
      pocName: brand!.pocName,
      pocPhone: brand!.pocPhone,
      pocEmail: brand!.pocEmail,
      logoUrl: brand!.logoUrl,
      email: brand!.user.email,
      campaignCount: brand!._count.campaigns,
      createdAt: brand!.createdAt.toISOString(),
      tempPassword: rawPassword,
    };
  }

  async getBrand(brandId: string) {
    const b = await this.prisma.brandProfile.findUnique({
      where: { id: brandId },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        campaigns: {
          orderBy: { createdAt: "desc" },
          include: {
            _count: { select: { submissions: true } },
          },
        },
      },
    });
    if (!b) throw new NotFoundException({ code: "NOT_FOUND", message: "Brand not found" });

    return {
      id: b.id,
      companyName: b.companyName,
      companyEmail: b.companyEmail,
      logoUrl: b.logoUrl,
      email: b.user.email,
      displayName: b.user.displayName,
      pocName: b.pocName,
      pocPhone: b.pocPhone,
      pocEmail: b.pocEmail,
      createdAt: b.createdAt.toISOString(),
      campaigns: b.campaigns.map((c) => ({
        ...this.campaigns.formatCampaign(c),
        submissionCount: c._count.submissions,
      })),
    };
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
    const [
      brandCount,
      campaignCount,
      activeCampaignCount,
      pendingInvites,
      viewsAgg,
      spentAgg,
      pendingTasks,
      topClippers,
    ] = await this.prisma.$transaction([
      this.prisma.brandProfile.count(),

      this.prisma.campaign.count(),

      this.prisma.campaign.count({ where: { status: "live" } }),

      this.prisma.campaignInvite.count({ where: { status: CampaignInviteStatus.pending } }),

      // total views across all deliverables
      this.prisma.formatDeliverable.aggregate({ _sum: { viewCount: true } }),

      // total budget spent across all campaigns
      this.prisma.campaign.aggregate({ _sum: { budgetUsedPaise: true } }),

      // pending tasks: deliverables needing admin review
      this.prisma.formatDeliverable.findMany({
        where: {
          status: { in: ["draft_pending", "under_review", "proof_under_review"] as any },
        },
        orderBy: { draftSubmittedAt: "asc" },
        take: 20,
        include: {
          participation: {
            include: {
              creator: { select: { displayName: true } },
              campaign: { select: { id: true, title: true } },
            },
          },
        },
      }),

      // top clippers by views (raw query to aggregate across deliverables)
      this.prisma.formatDeliverable.groupBy({
        by: ["participationId"],
        _sum: { viewCount: true },
        orderBy: { _sum: { viewCount: "desc" } },
        take: 10,
      }),
    ]);

    // resolve creator info for top clippers
    const topClipperDetails = await Promise.all(
      topClippers.map(async (t) => {
        const participation = await this.prisma.campaignParticipation.findUnique({
          where: { id: t.participationId },
          include: {
            creator: { select: { id: true, displayName: true } },
            campaign: { select: { ratePer1kPaise: true } },
          },
        });
        const views = t._sum?.viewCount ?? 0;
        const earned = participation
          ? Math.round((views / 1000) * participation.campaign.ratePer1kPaise)
          : 0;
        return {
          creatorId: participation?.creator.id ?? "",
          creatorName: participation?.creator.displayName ?? "Unknown",
          totalViews: views,
          earnedPaise: earned,
        };
      }),
    );

    // dedupe by creatorId and sum
    const clipperMap = new Map<string, { creatorName: string; totalViews: number; earnedPaise: number }>();
    for (const c of topClipperDetails) {
      const existing = clipperMap.get(c.creatorId);
      if (existing) {
        existing.totalViews += c.totalViews;
        existing.earnedPaise += c.earnedPaise;
      } else {
        clipperMap.set(c.creatorId, { creatorName: c.creatorName, totalViews: c.totalViews, earnedPaise: c.earnedPaise });
      }
    }
    const finalTopClippers = [...clipperMap.entries()]
      .map(([creatorId, v]) => ({ creatorId, ...v }))
      .sort((a, b) => b.earnedPaise - a.earnedPaise)
      .slice(0, 10);

    return {
      brandCount,
      campaignCount,
      activeCampaignCount,
      pendingInvites,
      totalViews: viewsAgg._sum.viewCount ?? 0,
      totalSpentPaise: spentAgg._sum.budgetUsedPaise ?? 0,
      pendingTasks: pendingTasks.map((d) => ({
        id: d.id,
        status: d.status,
        platform: d.platform,
        draftSubmittedAt: d.draftSubmittedAt?.toISOString() ?? null,
        creatorName: d.participation.creator.displayName ?? "Unknown",
        campaignId: d.participation.campaign.id,
        campaignTitle: d.participation.campaign.title,
      })),
      topClippers: finalTopClippers,
    };
  }

  async createTeamMember(dto: { name: string; email: string; password: string }) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException({ code: "CONFLICT", message: "Email already registered" });

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        role: UserRole.staff,
        email,
        passwordHash,
        displayName: dto.name.trim(),
        termsAcceptedAt: new Date(),
      },
    });
    // fire-and-forget email
    void this.email.sendStaffWelcome(email, dto.name.trim(), dto.password).catch(() => null);
    return this.formatStaffUser(user);
  }

  async listTeamMembers() {
    const members = await this.prisma.user.findMany({
      where: { role: UserRole.staff },
      orderBy: { createdAt: "desc" },
      include: {
        staffBrandAssignments: {
          include: { brandProfile: { select: { id: true, companyName: true, logoUrl: true } } },
        },
      },
    });
    return members.map((m) => this.formatStaffUser(m));
  }

  async assignBrandToStaff(staffUserId: string, brandProfileId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: staffUserId } });
    if (!user || user.role !== UserRole.staff) throw new NotFoundException({ code: "NOT_FOUND", message: "Team member not found" });
    const brand = await this.prisma.brandProfile.findUnique({ where: { id: brandProfileId } });
    if (!brand) throw new NotFoundException({ code: "NOT_FOUND", message: "Brand not found" });
    await this.prisma.staffBrandAssignment.upsert({
      where: { staffUserId_brandProfileId: { staffUserId, brandProfileId } },
      create: { staffUserId, brandProfileId },
      update: {},
    });
    return { assigned: true };
  }

  async removeBrandFromStaff(staffUserId: string, brandProfileId: string) {
    await this.prisma.staffBrandAssignment.deleteMany({ where: { staffUserId, brandProfileId } });
    return { removed: true };
  }

  private formatStaffUser(user: { id: string; email: string | null; displayName: string | null; createdAt: Date; staffBrandAssignments?: { brandProfile: { id: string; companyName: string; logoUrl: string | null } }[] }) {
    return {
      id: user.id,
      name: user.displayName ?? "",
      email: user.email ?? "",
      createdAt: user.createdAt.toISOString(),
      assignedBrands: (user.staffBrandAssignments ?? []).map((a) => a.brandProfile),
    };
  }
}
