import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AdminPermissionLevel, AdminSection, CampaignInviteStatus, FormatDeliverableStatus, KycStatus, StaffAccessLevel, SupportTicketStatus, UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";

import { ActivityLogService } from "../activity/activity-log.service";
import { computeEstimatedPaise } from "../common/earnings";
import { PrismaService } from "../prisma/prisma.service";
import { AdminRolesService } from "../admin-roles/admin-roles.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { FaqsService } from "../faqs/faqs.service";
import { BulkNotificationService } from "../notifications/bulk-notification.service";
import { EmailService } from "../notifications/email.service";
import { InAppNotificationService } from "../notifications/in-app-notification.service";
import { computeParticipationSummary, isParticipationCompleted } from "../participation/participation-summary";
import { RealtimeService } from "../realtime/realtime.service";
import { SupportService } from "../support/support.service";
import { WalletService } from "../wallet/wallet.service";
import type { ListCampaignsQueryDto } from "../campaigns/dto/list-campaigns-query.dto";

const ACTION_LABELS: Record<string, string> = {
  "campaign.created": "Created a campaign",
  "submission.approved": "Approved a submission",
  "submission.rejected": "Rejected a submission",
  "proof.approved": "Approved proof of work",
  "proof.rejected": "Rejected proof of work",
  "brand.assigned": "Was assigned a brand",
  "brand.unassigned": "Was unassigned from a brand",
  "staff.deactivated": "Account deactivated",
  "staff.reactivated": "Account reactivated",
  "task.assigned": "Was assigned a task",
  "task.completed": "Completed a task",
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly email: EmailService,
    private readonly wallet: WalletService,
    private readonly activityLog: ActivityLogService,
    private readonly notifications: InAppNotificationService,
    private readonly realtime: RealtimeService,
    private readonly support: SupportService,
    private readonly bulkNotifications: BulkNotificationService,
    private readonly faqs: FaqsService,
    private readonly adminRoles: AdminRolesService,
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
    logoUrl?: string;
  }) {
    const loginEmail = dto.companyEmail.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: loginEmail } });
    if (existing) {
      throw new ConflictException({ code: "CONFLICT", message: "Email already registered" });
    }
    const rawPassword = `Halchal@${Math.random().toString(36).slice(2, 10)}`;
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
          logoUrl: dto.logoUrl?.trim() || null,
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

  async updateBrand(brandId: string, dto: {
    companyName?: string;
    companyEmail?: string;
    pocName?: string;
    pocPhone?: string;
    pocEmail?: string;
    logoUrl?: string;
  }) {
    const existing = await this.prisma.brandProfile.findUnique({ where: { id: brandId } });
    if (!existing) throw new NotFoundException({ code: "NOT_FOUND", message: "Brand not found" });

    await this.prisma.brandProfile.update({
      where: { id: brandId },
      data: {
        companyName: dto.companyName?.trim() || undefined,
        companyEmail: dto.companyEmail?.trim().toLowerCase() || undefined,
        pocName: dto.pocName?.trim() ?? undefined,
        pocPhone: dto.pocPhone?.trim() ?? undefined,
        pocEmail: dto.pocEmail?.trim() ?? undefined,
        logoUrl: dto.logoUrl?.trim() || undefined,
      },
    });

    return this.getBrand(brandId);
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
        staffAssignments: {
          include: {
            staffUser: { select: { id: true, displayName: true, email: true } },
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
      assignedStaff: b.staffAssignments.map((a) => ({
        id: a.staffUser.id,
        name: a.staffUser.displayName ?? a.staffUser.email ?? "",
        email: a.staffUser.email ?? "",
        accessLevel: a.accessLevel,
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
              creator: { select: { id: true, displayName: true } },
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
        creatorId: d.participation.creator.id,
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

  async assignBrandToStaff(
    staffUserId: string,
    brandProfileId: string,
    accessLevel: StaffAccessLevel = StaffAccessLevel.full,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: staffUserId } });
    if (!user || user.role !== UserRole.staff) throw new NotFoundException({ code: "NOT_FOUND", message: "Team member not found" });
    const brand = await this.prisma.brandProfile.findUnique({ where: { id: brandProfileId } });
    if (!brand) throw new NotFoundException({ code: "NOT_FOUND", message: "Brand not found" });
    await this.prisma.staffBrandAssignment.upsert({
      where: { staffUserId_brandProfileId: { staffUserId, brandProfileId } },
      create: { staffUserId, brandProfileId, accessLevel },
      update: { accessLevel },
    });
    await this.activityLog.log(staffUserId, "brand.assigned", {
      targetType: "StaffBrandAssignment",
      targetId: staffUserId,
      brandProfileId,
      metadata: { companyName: brand.companyName, accessLevel },
    });
    await this.notifications.create(staffUserId, "staff", {
      type: "brand.assigned",
      title: "You were assigned a brand",
      body: brand.companyName,
      link: "/staff/brands",
    });
    return { assigned: true };
  }

  async removeBrandFromStaff(staffUserId: string, brandProfileId: string) {
    const brand = await this.prisma.brandProfile.findUnique({ where: { id: brandProfileId } });
    await this.prisma.staffBrandAssignment.deleteMany({ where: { staffUserId, brandProfileId } });
    await this.activityLog.log(staffUserId, "brand.unassigned", {
      targetType: "StaffBrandAssignment",
      targetId: staffUserId,
      brandProfileId,
    });
    await this.notifications.create(staffUserId, "staff", {
      type: "brand.unassigned",
      title: "You were unassigned from a brand",
      body: brand?.companyName,
      link: "/staff/brands",
    });
    return { removed: true };
  }

  async deactivateStaff(staffUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: staffUserId } });
    if (!user || user.role !== UserRole.staff) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Team member not found" });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: staffUserId }, data: { isActive: false } }),
      this.prisma.staffBrandAssignment.deleteMany({ where: { staffUserId } }),
    ]);
    await this.activityLog.log(staffUserId, "staff.deactivated", {
      targetType: "User",
      targetId: staffUserId,
    });
    return { deactivated: true };
  }

  async reactivateStaff(staffUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: staffUserId } });
    if (!user || user.role !== UserRole.staff) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Team member not found" });
    }
    await this.prisma.user.update({ where: { id: staffUserId }, data: { isActive: true } });
    await this.activityLog.log(staffUserId, "staff.reactivated", {
      targetType: "User",
      targetId: staffUserId,
    });
    return { reactivated: true };
  }

  async deleteStaff(staffUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: staffUserId } });
    if (!user || user.role !== UserRole.staff) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Team member not found" });
    }
    if (user.isActive) {
      throw new BadRequestException({ code: "MUST_DEACTIVATE_FIRST", message: "Deactivate the team member before deleting." });
    }
    await this.prisma.user.delete({ where: { id: staffUserId } });
    return { deleted: true };
  }

  async getStaffActivity(staffUserId: string, limit = 50) {
    const entries = await this.prisma.activityLog.findMany({
      where: { actorUserId: staffUserId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { brandProfile: { select: { companyName: true } } },
    });
    return entries.map((e) => ({
      id: e.id,
      action: e.action,
      label: ACTION_LABELS[e.action] ?? e.action,
      brandName: e.brandProfile?.companyName ?? null,
      metadata: e.metadata,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async listCreators() {
    const creators = await this.prisma.user.findMany({
      where: { role: UserRole.creator },
      include: {
        wallet: { select: { availablePaise: true, lifetimePaise: true } },
        _count: { select: { campaignParticipations: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return creators.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      username: c.username,
      email: c.email,
      phone: c.phone,
      avatarUrl: c.avatarUrl,
      kycStatus: c.kycStatus,
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
      campaignCount: c._count.campaignParticipations,
      walletAvailablePaise: c.wallet?.availablePaise ?? 0,
      walletLifetimePaise: c.wallet?.lifetimePaise ?? 0,
    }));
  }

  async getCreatorDetail(creatorId: string) {
    const creator = await this.prisma.user.findUnique({ where: { id: creatorId } });
    if (!creator || creator.role !== UserRole.creator) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Creator not found" });
    }

    const [wallet, payoutMethods, withdrawals, participations, linkedProfiles] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId: creatorId } }),
      this.prisma.payoutMethod.findMany({
        where: { userId: creatorId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      }),
      this.prisma.withdrawal.findMany({
        where: { userId: creatorId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      this.prisma.campaignParticipation.findMany({
        where: { creatorId },
        include: {
          campaign: { select: { id: true, title: true, status: true, ratePer1kPaise: true, maxPayoutPaise: true, coverImageUrl: true } },
          creatorProfile: { select: { platform: true, handle: true, label: true } },
          deliverables: {
            select: { status: true, draftDriveUrl: true, livePostUrl: true, viewCount: true, paidAmountPaise: true },
          },
        },
        orderBy: { joinedAt: "desc" },
      }),
      this.prisma.creatorProfile.findMany({
        where: { userId: creatorId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      }),
    ]);

    const runningCampaigns: Array<{ campaignId: string; title: string; status: string; coverImageUrl: string | null; viewCount: number; earnedPaise: number; handle: string; platform: string }> = [];
    const pastCampaigns: Array<{ campaignId: string; title: string; status: string; coverImageUrl: string | null; viewCount: number; earnedPaise: number; handle: string; platform: string }> = [];
    let totalViews = 0;
    let totalEarnedPaise = 0;

    for (const p of participations) {
      const { ratePer1kPaise, maxPayoutPaise } = p.campaign;
      const viewCount = p.deliverables.reduce((sum, d) => sum + d.viewCount, 0);
      const earnedPaise = p.deliverables.reduce(
        (sum, d) => sum + (d.paidAmountPaise ?? computeEstimatedPaise(d.viewCount, ratePer1kPaise, maxPayoutPaise)),
        0,
      );
      totalViews += viewCount;
      totalEarnedPaise += earnedPaise;

      const summary = computeParticipationSummary(p.deliverables, p.campaign.status);
      const entry = {
        campaignId: p.campaign.id,
        title: p.campaign.title,
        status: summary,
        coverImageUrl: p.campaign.coverImageUrl,
        viewCount,
        earnedPaise,
        handle: p.creatorProfile.handle,
        platform: p.creatorProfile.platform,
      };
      if (isParticipationCompleted(summary)) {
        pastCampaigns.push(entry);
      } else {
        runningCampaigns.push(entry);
      }
    }

    return {
      id: creator.id,
      displayName: creator.displayName,
      username: creator.username,
      email: creator.email,
      phone: creator.phone,
      avatarUrl: creator.avatarUrl,
      bio: creator.bio,
      socialLinks: (creator.socialLinks as Record<string, string> | null) ?? null,
      kycStatus: creator.kycStatus,
      kycDocumentUrl: creator.kycDocumentUrl,
      kycDocumentType: creator.kycDocumentType,
      kycSubmittedAt: creator.kycSubmittedAt?.toISOString() ?? null,
      kycRejectionReason: creator.kycRejectionReason,
      isActive: creator.isActive,
      createdAt: creator.createdAt.toISOString(),
      linkedProfiles: linkedProfiles.map((p) => ({
        id: p.id,
        platform: p.platform,
        handle: p.handle,
        label: p.label,
        avatarUrl: p.avatarUrl,
        isDefault: p.isDefault,
      })),
      wallet: {
        availablePaise: wallet?.availablePaise ?? 0,
        pendingPaise: wallet?.pendingPaise ?? 0,
        lifetimePaise: wallet?.lifetimePaise ?? 0,
      },
      payoutMethods: payoutMethods.map((m) => ({
        id: m.id,
        type: m.type,
        label: m.label,
        accountHolderName: m.accountHolderName,
        accountNumber: m.accountNumber,
        ifscCode: m.ifscCode,
        accountMasked: m.accountMasked,
        isDefault: m.isDefault,
      })),
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        amountPaise: w.amountPaise,
        feePaise: w.feePaise,
        netPaise: w.netPaise,
        status: w.status,
        createdAt: w.createdAt.toISOString(),
        processedAt: w.processedAt?.toISOString() ?? null,
      })),
      runningCampaigns,
      pastCampaigns,
      totalViews,
      totalEarnedPaise,
    };
  }

  async reviewKyc(creatorId: string, action: "approve" | "reject", reason?: string) {
    const creator = await this.prisma.user.findUnique({ where: { id: creatorId } });
    if (!creator || creator.role !== UserRole.creator) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Creator not found" });
    }
    if (creator.kycStatus !== KycStatus.pending) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "KYC is not pending review",
      });
    }
    if (action === "reject" && !reason?.trim()) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "reason required when rejecting",
      });
    }

    const status = action === "approve" ? KycStatus.verified : KycStatus.rejected;
    const updated = await this.prisma.user.update({
      where: { id: creatorId },
      data: {
        kycStatus: status,
        kycReviewedAt: new Date(),
        kycRejectionReason: action === "reject" ? reason!.trim() : null,
      },
    });

    await this.notifications.create(creatorId, "creator", {
      type: action === "approve" ? "kyc_verified" : "kyc_rejected",
      title: action === "approve" ? "KYC verified ✅" : "KYC needs attention",
      body:
        action === "approve"
          ? "Your identity has been verified. You're all set to receive payouts."
          : `Your KYC submission was rejected: ${reason!.trim()}`,
      link: "/profile/kyc",
    });

    return { id: updated.id, kycStatus: updated.kycStatus };
  }

  listSupportTickets(status?: SupportTicketStatus) {
    return this.support.listAllTickets(status);
  }

  getSupportTicket(id: string) {
    return this.support.getTicketDetail(id);
  }

  respondToSupportTicket(id: string, action: "investigating" | "resolved", note: string) {
    return this.support.respondToTicket(id, action, note);
  }

  bulkNotificationChannelStatus() {
    return this.bulkNotifications.channelStatus();
  }

  sendBulkNotification(
    sentByUserId: string,
    dto: { recipientIds: string[]; usePush: boolean; useWhatsapp: boolean; title: string; message: string },
  ) {
    return this.bulkNotifications.send(sentByUserId, dto);
  }

  listBulkNotificationHistory(page?: number, limit?: number) {
    return this.bulkNotifications.listHistory(page, limit);
  }

  listAllFaqs() {
    return this.faqs.listAll();
  }

  createFaq(dto: { question: string; answer: string; isVisible?: boolean }) {
    return this.faqs.create(dto);
  }

  updateFaq(id: string, dto: { question?: string; answer?: string; isVisible?: boolean }) {
    return this.faqs.update(id, dto);
  }

  deleteFaq(id: string) {
    return this.faqs.remove(id);
  }

  reorderFaqs(orderedIds: string[]) {
    return this.faqs.reorder(orderedIds);
  }

  listAdminRoles() {
    return this.adminRoles.listRoles();
  }

  createAdminRole(dto: { name: string; canSeeMoney?: boolean }) {
    return this.adminRoles.createRole(dto);
  }

  updateAdminRole(id: string, dto: { name?: string; canSeeMoney?: boolean }) {
    return this.adminRoles.updateRole(id, dto);
  }

  deleteAdminRole(id: string) {
    return this.adminRoles.deleteRole(id);
  }

  setAdminRolePermissions(
    roleId: string,
    permissions: { section: AdminSection; level: AdminPermissionLevel }[],
  ) {
    return this.adminRoles.setSectionPermissions(roleId, permissions);
  }

  resetAdminRolesToDefaults() {
    return this.adminRoles.resetToDefaults();
  }

  assignAdminRole(userId: string, adminRoleId: string | null) {
    return this.adminRoles.assignRole(userId, adminRoleId ?? null);
  }

  getMyAdminPermissions(userId: string) {
    return this.adminRoles.getEffectivePermissions(userId);
  }

  listAdminAccounts() {
    return this.adminRoles.listAdminAccounts();
  }

  private formatStaffUser(user: { id: string; email: string | null; displayName: string | null; createdAt: Date; isActive: boolean; staffBrandAssignments?: { accessLevel: StaffAccessLevel; brandProfile: { id: string; companyName: string; logoUrl: string | null } }[] }) {
    return {
      id: user.id,
      name: user.displayName ?? "",
      email: user.email ?? "",
      createdAt: user.createdAt.toISOString(),
      isActive: user.isActive,
      assignedBrands: (user.staffBrandAssignments ?? []).map((a) => ({ ...a.brandProfile, accessLevel: a.accessLevel })),
    };
  }

  async getCampaignPayouts(campaignId: string) {
    const deliverables = await this.prisma.formatDeliverable.findMany({
      where: {
        status: FormatDeliverableStatus.proof_approved,
        participation: { campaignId },
      },
      include: {
        participation: {
          include: {
            creator: { select: { id: true, displayName: true, username: true } },
            creatorProfile: { select: { id: true, platform: true, handle: true, label: true } },
            campaign: { select: { ratePer1kPaise: true, maxPayoutPaise: true } },
          },
        },
      },
      orderBy: { proofReviewedAt: "desc" },
    });

    // Keyed by creatorProfileId (not creatorId) — the same person's two linked
    // profiles joining the same campaign show as separate payout rows, since
    // each profile's deliverables/earnings are tracked independently.
    const byProfile = new Map<string, {
      creatorId: string;
      creatorProfileId: string;
      creatorName: string;
      handle: string;
      platform: string;
      deliverables: { id: string; platform: string; viewCount: number; earnedPaise: number; paidAt: string | null; paidAmountPaise: number | null }[];
      totalApprovedPaise: number;
      totalUnpaidPaise: number;
      totalPaidPaise: number;
    }>();

    for (const d of deliverables) {
      const creator = d.participation.creator;
      const profile = d.participation.creatorProfile;
      const { ratePer1kPaise, maxPayoutPaise } = d.participation.campaign;
      const earnedPaise = d.paidAmountPaise ?? computeEstimatedPaise(d.viewCount, ratePer1kPaise, maxPayoutPaise);

      let entry = byProfile.get(profile.id);
      if (!entry) {
        entry = {
          creatorId: creator.id,
          creatorProfileId: profile.id,
          creatorName: profile.label ?? creator.displayName ?? creator.username ?? "Creator",
          handle: profile.handle,
          platform: profile.platform,
          deliverables: [],
          totalApprovedPaise: 0,
          totalUnpaidPaise: 0,
          totalPaidPaise: 0,
        };
        byProfile.set(profile.id, entry);
      }

      entry.deliverables.push({
        id: d.id,
        platform: d.platform,
        viewCount: d.viewCount,
        earnedPaise,
        paidAt: d.paidAt?.toISOString() ?? null,
        paidAmountPaise: d.paidAmountPaise,
      });
      entry.totalApprovedPaise += earnedPaise;
      if (d.paidAt) {
        entry.totalPaidPaise += d.paidAmountPaise ?? 0;
      } else {
        entry.totalUnpaidPaise += earnedPaise;
      }
    }

    return Array.from(byProfile.values());
  }

  async payoutCampaign(campaignId: string, creatorId?: string) {
    const deliverables = await this.prisma.formatDeliverable.findMany({
      where: {
        status: FormatDeliverableStatus.proof_approved,
        paidAt: null,
        participation: {
          campaignId,
          ...(creatorId ? { creatorId } : {}),
        },
      },
      include: {
        participation: {
          include: {
            campaign: { select: { title: true, ratePer1kPaise: true, maxPayoutPaise: true, brandProfileId: true } },
          },
        },
      },
    });

    let paidCount = 0;
    let totalPaidPaise = 0;

    for (const d of deliverables) {
      const { title, ratePer1kPaise, maxPayoutPaise, brandProfileId } = d.participation.campaign;
      const amountPaise = computeEstimatedPaise(d.viewCount, ratePer1kPaise, maxPayoutPaise);

      // Atomic compare-and-swap via the WHERE clause: only proceeds if still unpaid,
      // so concurrent payout requests can never double-credit the same deliverable.
      const { count } = await this.prisma.formatDeliverable.updateMany({
        where: { id: d.id, paidAt: null },
        data: { paidAt: new Date(), paidAmountPaise: amountPaise },
      });
      if (count === 0) continue;

      await this.wallet.creditEarning(
        d.participation.creatorId,
        amountPaise,
        d.id,
        `Payout: ${title} (${d.platform})`,
      );

      this.realtime.emitDeliverablePaid({
        deliverableId: d.id,
        participationId: d.participationId,
        campaignId: d.participation.campaignId,
        creatorId: d.participation.creatorId,
        brandProfileId,
        platform: d.platform,
        status: d.status,
        amountPaise,
      });

      await this.notifications.create(d.participation.creatorId, "creator", {
        type: "payout_paid",
        title: "You got paid 💸",
        body: `${title} (${d.platform}) payout has landed in your wallet.`,
        link: "/wallet",
      });

      paidCount += 1;
      totalPaidPaise += amountPaise;
    }

    return { paidCount, totalPaidPaise };
  }
}
