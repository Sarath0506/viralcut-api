import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CampaignStatus, SubmissionStatus, UserRole } from "@prisma/client";

import { CampaignAccessService } from "../access/campaign-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReviewAction, ReviewSubmissionDto } from "./dto/review-submission.dto";
import type { CreateSubmissionDto } from "./dto/create-submission.dto";
import type { SubmitLiveLinkDto } from "./dto/create-submission.dto";

function computeEarningsPaise(views: number, ratePer1kPaise: number): number {
  return Math.floor((views / 1000) * ratePer1kPaise);
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignAccess: CampaignAccessService,
  ) {}

  private async resolveBrandProfileIds(
    userId: string,
    role: UserRole,
  ): Promise<string[] | null> {
    if (role === UserRole.admin) {
      return null;
    }
    const brandProfileId =
      await this.campaignAccess.getBrandProfileIdForUser(userId);
    return brandProfileId ? [brandProfileId] : [];
  }

  async listForBrand(
    userId: string,
    role: UserRole,
    filters?: {
      status?: SubmissionStatus;
      campaignId?: string;
      brandProfileId?: string;
    },
  ) {
    const brandProfileIds = await this.resolveBrandProfileIds(userId, role);
    if (brandProfileIds && brandProfileIds.length === 0) {
      return [];
    }

    const submissions = await this.prisma.submission.findMany({
      where: {
        ...(brandProfileIds
          ? { campaign: { brandProfileId: { in: brandProfileIds } } }
          : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.campaignId ? { campaignId: filters.campaignId } : {}),
      },
      include: {
        campaign: { select: { id: true, title: true } },
        creator: {
          select: { id: true, displayName: true, username: true },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: 100,
    });

    return submissions.map((s) => ({
      id: s.id,
      status: s.status,
      mediaType: s.mediaType,
      campaignId: s.campaign.id,
      campaignTitle: s.campaign.title,
      creatorName: s.creator.displayName ?? s.creator.username ?? "Creator",
      eligibleViews: s.eligibleViews,
      estimatedPaise: s.estimatedPaise,
      submittedAt: s.submittedAt.toISOString(),
    }));
  }

  async getForBrand(
    userId: string,
    role: UserRole,
    submissionId: string,
  ) {
    const s = await this.prisma.submission.findFirst({
      where: { id: submissionId },
      include: {
        campaign: true,
        creator: {
          select: {
            id: true,
            displayName: true,
            username: true,
            phone: true,
          },
        },
      },
    });

    if (!s) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Submission not found",
      });
    }

    await this.campaignAccess.assertCanAccessCampaign(
      userId,
      role,
      s.campaign,
    );

    return {
      id: s.id,
      status: s.status,
      mediaType: s.mediaType,
      draftDriveUrl: s.draftDriveUrl,
      liveReelUrl: s.liveReelUrl,
      rejectionReason: s.rejectionReason,
      eligibleViews: s.eligibleViews,
      estimatedPaise: s.estimatedPaise,
      submittedAt: s.submittedAt.toISOString(),
      approvedAt: s.approvedAt?.toISOString() ?? null,
      campaign: {
        id: s.campaign.id,
        title: s.campaign.title,
        ratePer1kDisplay: `₹${s.campaign.ratePer1kPaise / 100} / 1K views`,
      },
      creator: s.creator,
    };
  }

  async review(
    userId: string,
    role: UserRole,
    submissionId: string,
    dto: ReviewSubmissionDto,
  ) {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId },
      include: { campaign: true },
    });

    if (!submission) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Submission not found",
      });
    }

    await this.campaignAccess.assertCanAccessCampaign(
      userId,
      role,
      submission.campaign,
    );

    if (
      submission.status !== SubmissionStatus.draft_submitted &&
      submission.status !== SubmissionStatus.under_review
    ) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Submission is not in a reviewable state",
      });
    }

    if (dto.action === ReviewAction.approve) {
      const updated = await this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          status: SubmissionStatus.awaiting_live_link,
          approvedAt: new Date(),
        },
      });
      return { id: updated.id, status: updated.status };
    }

    if (!dto.rejectionReason?.trim()) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "rejectionReason required when rejecting",
      });
    }

    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.rejected,
        rejectionReason: dto.rejectionReason,
      },
    });
    return { id: updated.id, status: updated.status };
  }

  async listForCreator(userId: string, tab: "active" | "completed" = "active") {
    const activeStatuses: SubmissionStatus[] = [
      SubmissionStatus.draft_submitted,
      SubmissionStatus.under_review,
      SubmissionStatus.approved,
      SubmissionStatus.awaiting_live_link,
      SubmissionStatus.live_tracking,
      SubmissionStatus.payout_pending,
    ];
    const completedStatuses: SubmissionStatus[] = [
      SubmissionStatus.paid,
      SubmissionStatus.rejected,
    ];

    const submissions = await this.prisma.submission.findMany({
      where: {
        creatorId: userId,
        status: {
          in: tab === "active" ? activeStatuses : completedStatuses,
        },
      },
      include: { campaign: { select: { title: true, maxPayoutPaise: true } } },
      orderBy: { submittedAt: "desc" },
    });

    return submissions.map((s) => ({
      id: s.id,
      status: s.status,
      campaignTitle: s.campaign.title,
      maxPayoutPaise: s.campaign.maxPayoutPaise,
      eligibleViews: s.eligibleViews,
      estimatedPaise: s.estimatedPaise,
      submittedAt: s.submittedAt.toISOString(),
    }));
  }

  async getForCreator(userId: string, submissionId: string) {
    const s = await this.prisma.submission.findFirst({
      where: { id: submissionId, creatorId: userId },
      include: { campaign: true },
    });
    if (!s) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Submission not found",
      });
    }

    return {
      id: s.id,
      status: s.status,
      mediaType: s.mediaType,
      draftDriveUrl: s.draftDriveUrl,
      liveReelUrl: s.liveReelUrl,
      rejectionReason: s.rejectionReason,
      eligibleViews: s.eligibleViews,
      estimatedPaise: s.estimatedPaise,
      ratePer1kDisplay: `₹${s.campaign.ratePer1kPaise / 100} / 1K views`,
      submittedAt: s.submittedAt.toISOString(),
      approvedAt: s.approvedAt?.toISOString() ?? null,
      campaign: {
        id: s.campaign.id,
        title: s.campaign.title,
      },
    };
  }

  async createForCreator(userId: string, dto: CreateSubmissionDto) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: dto.campaignId, status: CampaignStatus.live },
    });
    if (!campaign) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not available",
      });
    }

    if (!dto.draftDriveUrl?.trim()) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "draftDriveUrl is required",
      });
    }

    const submission = await this.prisma.submission.create({
      data: {
        campaignId: dto.campaignId,
        creatorId: userId,
        mediaType: dto.mediaType ?? "video",
        draftDriveUrl: dto.draftDriveUrl,
        status: SubmissionStatus.draft_submitted,
      },
    });

    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.under_review },
    });

    return {
      id: submission.id,
      status: SubmissionStatus.under_review,
    };
  }

  async submitLiveLink(
    userId: string,
    submissionId: string,
    dto: SubmitLiveLinkDto,
  ) {
    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, creatorId: userId },
      include: { campaign: true },
    });

    if (!submission) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Submission not found",
      });
    }

    if (submission.status !== SubmissionStatus.awaiting_live_link) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Submission is not awaiting live link",
      });
    }

    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        liveReelUrl: dto.liveReelUrl,
        liveLinkAt: new Date(),
        status: SubmissionStatus.live_tracking,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      liveReelUrl: updated.liveReelUrl,
    };
  }

  async creatorDashboard(userId: string) {
    const [wallet, reviewCount, trending] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId } }),
      this.prisma.submission.count({
        where: {
          creatorId: userId,
          status: {
            in: [
              SubmissionStatus.draft_submitted,
              SubmissionStatus.under_review,
            ],
          },
        },
      }),
      this.prisma.campaign.findMany({
        where: { status: CampaignStatus.live },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    return {
      wallet: {
        availablePaise: wallet?.availablePaise ?? 0,
        pendingPaise: wallet?.pendingPaise ?? 0,
        lifetimePaise: wallet?.lifetimePaise ?? 0,
      },
      clipsUnderReview: reviewCount,
      trending: trending.map((c) => ({
        id: c.id,
        title: c.title,
        ratePer1kDisplay: `₹${c.ratePer1kPaise / 100} / 1K views`,
        maxPayoutPaise: c.maxPayoutPaise,
        poolPercent:
          c.budgetPaise > 0
            ? Math.round((c.budgetUsedPaise / c.budgetPaise) * 100)
            : 0,
      })),
    };
  }

  /** Simulate view sync for demo — updates earnings from eligible views */
  async syncPerformance(userId: string, submissionId: string, views: number) {
    const s = await this.prisma.submission.findFirst({
      where: {
        id: submissionId,
        creatorId: userId,
        status: SubmissionStatus.live_tracking,
      },
      include: { campaign: true },
    });
    if (!s) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Submission not tracking",
      });
    }

    const estimatedPaise = Math.min(
      computeEarningsPaise(views, s.campaign.ratePer1kPaise),
      s.campaign.maxPayoutPaise,
    );

    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: { eligibleViews: views, estimatedPaise },
    });

    return {
      id: updated.id,
      eligibleViews: updated.eligibleViews,
      estimatedPaise: updated.estimatedPaise,
      ratePer1kDisplay: `₹${s.campaign.ratePer1kPaise / 100} / 1K views`,
    };
  }

  /** Brand dashboard stats */
  async brandStats(userId: string, role: UserRole) {
    const brandProfileIds = await this.resolveBrandProfileIds(userId, role);
    if (brandProfileIds && brandProfileIds.length === 0) {
      return {
        liveCampaigns: 0,
        pendingReviews: 0,
        budgetUsedPaise: 0,
        totalViews: 0,
      };
    }

    const brandFilter = brandProfileIds
      ? { brandProfileId: { in: brandProfileIds } }
      : {};

    const [liveCampaigns, pendingReviews, budgetAgg, viewsAgg] =
      await Promise.all([
        this.prisma.campaign.count({
          where: { ...brandFilter, status: "live" },
        }),
        this.prisma.submission.count({
          where: {
            campaign: brandFilter,
            status: {
              in: [
                SubmissionStatus.draft_submitted,
                SubmissionStatus.under_review,
              ],
            },
          },
        }),
        this.prisma.campaign.aggregate({
          where: brandFilter,
          _sum: { budgetUsedPaise: true },
        }),
        this.prisma.submission.aggregate({
          where: { campaign: brandFilter },
          _sum: { eligibleViews: true },
        }),
      ]);

    return {
      liveCampaigns,
      pendingReviews,
      budgetUsedPaise: budgetAgg._sum.budgetUsedPaise ?? 0,
      totalViews: viewsAgg._sum.eligibleViews ?? 0,
    };
  }
}
