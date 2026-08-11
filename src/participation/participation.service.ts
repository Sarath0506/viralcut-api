import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CampaignStatus,
  FormatDeliverableStatus,
  Prisma,
  UserRole,
} from "@prisma/client";

import { ActivityLogService } from "../activity/activity-log.service";
import { CampaignAccessService } from "../access/campaign-access.service";
import { normalizeCampaignPlatforms } from "../campaigns/campaign-platforms";
import { ApifyService } from "../common/apify.service";
import { computeEstimatedPaise } from "../common/earnings";
import { CreatorProfilesService } from "../creator-profiles/creator-profiles.service";
import { InAppNotificationService } from "../notifications/in-app-notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { DRAFT_URL_MESSAGE, isValidDraftUrl } from "./drive-url";
import { ReviewDeliverableAction } from "./dto/review-deliverable.dto";
import type { SubmitDraftDto } from "./dto/submit-draft.dto";
import type { SubmitLiveProofDto } from "./dto/submit-live-proof.dto";
import {
  computeParticipationSummary,
  isParticipationCompleted,
} from "./participation-summary";
import {
  isDuplicateRejectionReason,
  REJECTION_HISTORY_LIMIT,
} from "./rejection-reason";

function formatPlatform(platform: string): string {
  const labels: Record<string, string> = {
    instagram_reel: "Instagram Reel",
    instagram_reels: "Instagram Reel",
    instagram_post: "Instagram Post",
    youtube_shorts: "YouTube Shorts",
    twitter_tweet: "Twitter / X",
  };
  return labels[platform] ?? platform.replace(/_/g, " ");
}

const rejectionEventsInclude = {
  orderBy: { rejectedAt: "desc" as const },
  take: REJECTION_HISTORY_LIMIT,
  include: {
    reviewedBy: { select: { displayName: true } },
  },
} satisfies Prisma.DeliverableRejectionEventFindManyArgs;

const participationInclude = {
  campaign: {
    select: {
      id: true,
      title: true,
      status: true,
      platforms: true,
      platform: true,
      ratePer1kPaise: true,
      maxPayoutPaise: true,
      coverImageUrl: true,
      brandProfile: { select: { companyName: true, logoUrl: true } },
    },
  },
  creatorProfile: {
    select: { id: true, platform: true, handle: true, label: true, avatarUrl: true },
  },
  deliverables: {
    orderBy: { platform: "asc" as const },
    include: {
      rejectionEvents: rejectionEventsInclude,
    },
  },
} satisfies Prisma.CampaignParticipationInclude;

type ParticipationWithRelations = Prisma.CampaignParticipationGetPayload<{
  include: typeof participationInclude;
}>;

@Injectable()
export class ParticipationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignAccess: CampaignAccessService,
    private readonly realtime: RealtimeService,
    private readonly apify: ApifyService,
    private readonly activityLog: ActivityLogService,
    private readonly notifications: InAppNotificationService,
    private readonly creatorProfiles: CreatorProfilesService,
  ) {}

  private deliverableEventPayload(
    deliverable: {
      id: string;
      platform: string;
      status: FormatDeliverableStatus;
      participationId: string;
    },
    participation: {
      creatorId: string;
      campaignId: string;
      campaign: { brandProfileId: string | null };
    },
  ) {
    return {
      deliverableId: deliverable.id,
      participationId: deliverable.participationId,
      campaignId: participation.campaignId,
      creatorId: participation.creatorId,
      brandProfileId: participation.campaign.brandProfileId,
      platform: deliverable.platform,
      status: deliverable.status,
    };
  }

  private formatRejectionHistory(
    events: Array<{
      id: string;
      rejectionReason: string;
      draftDriveUrl: string;
      rejectedAt: Date;
      reviewedBy: { displayName: string | null } | null;
    }>,
  ) {
    return events.map((e) => ({
      id: e.id,
      rejectionReason: e.rejectionReason,
      draftDriveUrl: e.draftDriveUrl,
      rejectedAt: e.rejectedAt.toISOString(),
      reviewedByDisplayName: e.reviewedBy?.displayName ?? null,
    }));
  }

  private formatDeliverable(
    d: ParticipationWithRelations["deliverables"][0],
    campaign?: { ratePer1kPaise: number; maxPayoutPaise: number },
  ) {
    const ratePer1kPaise = campaign?.ratePer1kPaise ?? 0;
    const estimatedPaise = ratePer1kPaise > 0
      ? Math.min(
          Math.floor((d.viewCount / 1000) * ratePer1kPaise),
          campaign?.maxPayoutPaise ?? Infinity,
        )
      : 0;

    return {
      id: d.id,
      platform: d.platform,
      status: d.status,
      draftDriveUrl: d.draftDriveUrl,
      livePostUrl: d.livePostUrl,
      rejectionReason: d.rejectionReason,
      draftSubmittedAt: d.draftSubmittedAt?.toISOString() ?? null,
      draftReviewedAt: d.draftReviewedAt?.toISOString() ?? null,
      liveSubmittedAt: d.liveSubmittedAt?.toISOString() ?? null,
      proofReviewedAt: d.proofReviewedAt?.toISOString() ?? null,
      viewCount: d.viewCount,
      reach: d.reach,
      likeCount: d.likeCount,
      commentCount: d.commentCount,
      shareCount: d.shareCount,
      estimatedPaise,
      ratePer1kPaise,
      rejectionHistory: this.formatRejectionHistory(d.rejectionEvents),
    };
  }

  private formatParticipation(participation: ParticipationWithRelations) {
    const summary = computeParticipationSummary(
      participation.deliverables,
      participation.campaign.status,
    );
    return {
      id: participation.id,
      campaignId: participation.campaignId,
      joinedAt: participation.joinedAt.toISOString(),
      platformsSnapshot: participation.platformsSnapshot,
      summary,
      creatorProfile: {
        id: participation.creatorProfile.id,
        platform: participation.creatorProfile.platform,
        handle: participation.creatorProfile.handle,
        label: participation.creatorProfile.label,
        avatarUrl: participation.creatorProfile.avatarUrl,
      },
      campaign: {
        id: participation.campaign.id,
        title: participation.campaign.title,
        status: participation.campaign.status,
        platforms: normalizeCampaignPlatforms(
          participation.campaign.platforms,
          participation.campaign.platform,
        ),
        brandCompanyName:
          participation.campaign.brandProfile?.companyName ?? null,
        brandLogoUrl: participation.campaign.brandProfile?.logoUrl ?? null,
        coverImageUrl: participation.campaign.coverImageUrl ?? null,
        ratePer1kDisplay: `₹${participation.campaign.ratePer1kPaise / 100} / 1K views`,
        ratePer1kPaise: participation.campaign.ratePer1kPaise,
        maxPayoutPaise: participation.campaign.maxPayoutPaise,
      },
      deliverables: participation.deliverables.map((d) =>
        this.formatDeliverable(d, participation.campaign),
      ),
    };
  }

  private async loadParticipation(
    where: Prisma.CampaignParticipationWhereInput,
  ): Promise<ParticipationWithRelations> {
    const participation = await this.prisma.campaignParticipation.findFirst({
      where,
      include: participationInclude,
    });
    if (!participation) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Participation not found",
      });
    }
    return participation;
  }

  private assertCampaignOpenForCreator(campaignStatus: CampaignStatus) {
    if (campaignStatus !== CampaignStatus.live) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Campaign is not open for submissions",
      });
    }
  }

  async joinCampaign(
    creatorId: string,
    campaignId: string,
    creatorProfileId: string,
  ) {
    await this.creatorProfiles.assertOwnership(creatorId, creatorProfileId);

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId },
    });
    if (!campaign || campaign.status !== CampaignStatus.live) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not available",
      });
    }

    const existing = await this.prisma.campaignParticipation.findUnique({
      where: {
        campaignId_creatorProfileId: { campaignId, creatorProfileId },
      },
      include: participationInclude,
    });
    if (existing) {
      throw new ConflictException({
        code: "ALREADY_JOINED",
        message: "This profile already joined this campaign",
        details: { participation: this.formatParticipation(existing) },
      });
    }

    const platforms = normalizeCampaignPlatforms(
      campaign.platforms,
      campaign.platform,
    );

    const participation = await this.prisma.campaignParticipation.create({
      data: {
        campaignId,
        creatorId,
        creatorProfileId,
        platformsSnapshot: platforms,
        deliverables: {
          create: platforms.map((platform) => ({
            platform,
            status: FormatDeliverableStatus.draft_pending,
          })),
        },
      },
      include: participationInclude,
    });

    this.realtime.emitParticipationJoined({
      participationId: participation.id,
      campaignId,
      creatorId,
      brandProfileId: campaign.brandProfileId,
    });

    return this.formatParticipation(participation);
  }

  async getParticipationByCampaign(
    creatorId: string,
    campaignId: string,
    creatorProfileId: string,
  ) {
    const participation = await this.loadParticipation({
      campaignId,
      creatorId,
      creatorProfileId,
    });
    return this.formatParticipation(participation);
  }

  async submitDraft(
    creatorId: string,
    deliverableId: string,
    dto: SubmitDraftDto,
  ) {
    const deliverable = await this.prisma.formatDeliverable.findFirst({
      where: { id: deliverableId },
      include: {
        rejectionEvents: {
          orderBy: { rejectedAt: "desc" },
          take: 1,
        },
        participation: {
          include: { campaign: true },
        },
      },
    });

    if (!deliverable || deliverable.participation.creatorId !== creatorId) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Deliverable not found",
      });
    }

    this.assertCampaignOpenForCreator(
      deliverable.participation.campaign.status,
    );

    const resubmittable: FormatDeliverableStatus[] = [
      FormatDeliverableStatus.draft_pending,
      FormatDeliverableStatus.draft_rejected,
    ];
    if (!resubmittable.includes(deliverable.status)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "This format cannot accept a new draft right now",
      });
    }

    if (!isValidDraftUrl(dto.draftDriveUrl)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: DRAFT_URL_MESSAGE,
      });
    }

    const trimmedUrl = dto.draftDriveUrl.trim();
    const lastRejected = deliverable.rejectionEvents[0];
    if (
      deliverable.status === FormatDeliverableStatus.draft_rejected &&
      lastRejected &&
      lastRejected.draftDriveUrl.trim() === trimmedUrl
    ) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message:
          "This Drive link was already rejected. Upload an updated creative or use a new link.",
      });
    }

    const updated = await this.prisma.formatDeliverable.update({
      where: { id: deliverableId },
      data: {
        draftDriveUrl: trimmedUrl,
        status: FormatDeliverableStatus.under_review,
        rejectionReason: null,
        draftSubmittedAt: new Date(),
      },
    });

    this.realtime.emitDeliverableSubmitted(
      this.deliverableEventPayload(updated, deliverable.participation),
    );

    return {
      id: updated.id,
      status: updated.status,
      draftDriveUrl: updated.draftDriveUrl,
    };
  }

  async submitLiveProof(
    creatorId: string,
    deliverableId: string,
    dto: SubmitLiveProofDto,
  ) {
    const deliverable = await this.prisma.formatDeliverable.findFirst({
      where: { id: deliverableId },
      include: {
        participation: {
          include: { campaign: true },
        },
      },
    });

    if (!deliverable || deliverable.participation.creatorId !== creatorId) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Deliverable not found",
      });
    }

    this.assertCampaignOpenForCreator(
      deliverable.participation.campaign.status,
    );

    if (deliverable.status !== FormatDeliverableStatus.draft_approved) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Live proof can only be submitted after draft approval",
      });
    }

    const updated = await this.prisma.formatDeliverable.update({
      where: { id: deliverableId },
      data: {
        livePostUrl: dto.livePostUrl.trim(),
        status: FormatDeliverableStatus.proof_under_review,
        liveSubmittedAt: new Date(),
      },
    });

    this.realtime.emitDeliverableLiveProof(
      this.deliverableEventPayload(updated, deliverable.participation),
    );

    return {
      id: updated.id,
      status: updated.status,
      livePostUrl: updated.livePostUrl,
    };
  }

  async listForCreator(
    creatorId: string,
    tab: "active" | "completed" = "active",
    creatorProfileId?: string,
  ) {
    const participations = await this.prisma.campaignParticipation.findMany({
      where: { creatorId, ...(creatorProfileId ? { creatorProfileId } : {}) },
      include: participationInclude,
      orderBy: { joinedAt: "desc" },
    });

    return participations
      .map((p) => this.formatParticipation(p))
      .filter((p) => {
        const completed = isParticipationCompleted(p.summary);
        return tab === "completed" ? completed : !completed;
      })
      .map((p) => ({
        id: p.id,
        summary: p.summary,
        campaignId: p.campaignId,
        campaignTitle: p.campaign.title,
        brandCompanyName: p.campaign.brandCompanyName,
        brandLogoUrl: p.campaign.brandLogoUrl,
        coverImageUrl: p.campaign.coverImageUrl,
        platforms: p.campaign.platforms,
        joinedAt: p.joinedAt,
        creatorProfile: p.creatorProfile,
        deliverables: p.deliverables.map((d) => ({
          id: d.id,
          platform: d.platform,
          status: d.status,
          priorRejectionCount: d.rejectionHistory.length,
        })),
      }));
  }

  async getForCreator(creatorId: string, participationId: string) {
    const participation = await this.loadParticipation({
      id: participationId,
      creatorId,
    });
    return this.formatParticipation(participation);
  }

  private async resolveBrandProfileIds(
    userId: string,
    role: UserRole,
  ): Promise<string[] | null> {
    if (role === UserRole.admin) {
      return null;
    }
    if (role === UserRole.staff) {
      const assignments = await this.prisma.staffBrandAssignment.findMany({
        where: { staffUserId: userId },
        select: { brandProfileId: true },
      });
      return assignments.map((a) => a.brandProfileId);
    }
    const brandProfileId =
      await this.campaignAccess.getBrandProfileIdForUser(userId);
    return brandProfileId ? [brandProfileId] : [];
  }

  /** Public, unauthenticated read-only deliverables list for a campaign's share link. No phone numbers, no rate/budget fields. */
  async getPublicDeliverables(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.status === CampaignStatus.draft) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Campaign not available",
      });
    }

    const deliverables = await this.prisma.formatDeliverable.findMany({
      where: { participation: { campaignId } },
      include: {
        _count: { select: { rejectionEvents: true } },
        participation: {
          include: {
            creator: { select: { id: true, displayName: true, username: true } },
            deliverables: {
              select: { id: true, platform: true, status: true },
              orderBy: { platform: "asc" },
            },
          },
        },
      },
      orderBy: { draftSubmittedAt: "desc" },
    });

    return deliverables.map((d) => {
      const estimatedPaise = campaign.ratePer1kPaise > 0
        ? Math.min(Math.floor((d.viewCount / 1000) * campaign.ratePer1kPaise), campaign.maxPayoutPaise)
        : 0;
      return {
        id: d.id,
        platform: d.platform,
        status: d.status,
        draftDriveUrl: d.draftDriveUrl,
        livePostUrl: d.livePostUrl,
        rejectionReason: d.rejectionReason,
        draftSubmittedAt: d.draftSubmittedAt?.toISOString() ?? null,
        participationId: d.participationId,
        joinedAt: d.participation.joinedAt.toISOString(),
        creatorName:
          d.participation.creator.displayName ??
          d.participation.creator.username ??
          "Creator",
        priorRejectionCount: d._count.rejectionEvents,
        viewCount: d.viewCount,
        likeCount: d.likeCount,
        commentCount: d.commentCount,
        shareCount: d.shareCount,
        estimatedPaise,
        siblingDeliverables: d.participation.deliverables.map((s) => ({
          id: s.id,
          platform: s.platform,
          status: s.status,
        })),
      };
    });
  }

  async listDeliverablesForBrand(
    userId: string,
    role: UserRole,
    filters?: { status?: FormatDeliverableStatus; campaignId?: string },
  ) {
    const brandProfileIds = await this.resolveBrandProfileIds(userId, role);
    if (brandProfileIds && brandProfileIds.length === 0) {
      return [];
    }

    // When fetching by campaignId with no explicit status, return all statuses.
    // Otherwise default to under_review for the global submissions list.
    const statusFilter =
      filters?.status
        ? { status: filters.status }
        : filters?.campaignId
          ? {}
          : { status: FormatDeliverableStatus.under_review };

    const deliverables = await this.prisma.formatDeliverable.findMany({
      where: {
        ...statusFilter,
        ...(filters?.campaignId
          ? {
              participation: { campaignId: filters.campaignId },
            }
          : {}),
        ...(brandProfileIds
          ? {
              participation: {
                campaign: { brandProfileId: { in: brandProfileIds } },
              },
            }
          : {}),
      },
      include: {
        _count: { select: { rejectionEvents: true } },
        participation: {
          include: {
            campaign: { select: { id: true, title: true, ratePer1kPaise: true, maxPayoutPaise: true } },
            creator: {
              select: { id: true, displayName: true, username: true },
            },
            creatorProfile: {
              select: { id: true, platform: true, handle: true, label: true, avatarUrl: true },
            },
            deliverables: {
              select: { id: true, platform: true, status: true },
              orderBy: { platform: "asc" },
            },
          },
        },
      },
      orderBy: { draftSubmittedAt: "desc" },
      take: 100,
    });

    return deliverables.map((d) => {
      const ratePer1kPaise = d.participation.campaign.ratePer1kPaise;
      const estimatedPaise = ratePer1kPaise > 0
        ? Math.min(
            Math.floor((d.viewCount / 1000) * ratePer1kPaise),
            d.participation.campaign.maxPayoutPaise,
          )
        : 0;
      return {
      id: d.id,
      platform: d.platform,
      status: d.status,
      draftDriveUrl: d.draftDriveUrl,
      draftSubmittedAt: d.draftSubmittedAt?.toISOString() ?? null,
      campaignId: d.participation.campaign.id,
      campaignTitle: d.participation.campaign.title,
      participationId: d.participationId,
      joinedAt: d.participation.joinedAt.toISOString(),
      creatorId: d.participation.creator.id,
      creatorName:
        d.participation.creator.displayName ??
        d.participation.creator.username ??
        "Creator",
      creatorProfile: {
        id: d.participation.creatorProfile.id,
        platform: d.participation.creatorProfile.platform,
        handle: d.participation.creatorProfile.handle,
        label: d.participation.creatorProfile.label,
        avatarUrl: d.participation.creatorProfile.avatarUrl,
      },
      priorRejectionCount: d._count.rejectionEvents,
      viewCount: d.viewCount,
      likeCount: d.likeCount,
      commentCount: d.commentCount,
      shareCount: d.shareCount,
      estimatedPaise,
      siblingDeliverables: d.participation.deliverables.map((s) => ({
        id: s.id,
        platform: s.platform,
        status: s.status,
      })),
      };
    });
  }

  async getDeliverableForBrand(
    userId: string,
    role: UserRole,
    deliverableId: string,
  ) {
    const deliverable = await this.prisma.formatDeliverable.findFirst({
      where: { id: deliverableId },
      include: {
        rejectionEvents: rejectionEventsInclude,
        participation: {
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
            creatorProfile: {
              select: { id: true, platform: true, handle: true, label: true, avatarUrl: true },
            },
            deliverables: { orderBy: { platform: "asc" } },
          },
        },
      },
    });

    if (!deliverable) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Deliverable not found",
      });
    }

    await this.campaignAccess.assertCanAccessCampaign(
      userId,
      role,
      deliverable.participation.campaign,
    );

    return {
      id: deliverable.id,
      platform: deliverable.platform,
      status: deliverable.status,
      draftDriveUrl: deliverable.draftDriveUrl,
      livePostUrl: deliverable.livePostUrl,
      rejectionReason: deliverable.rejectionReason,
      draftSubmittedAt: deliverable.draftSubmittedAt?.toISOString() ?? null,
      draftReviewedAt: deliverable.draftReviewedAt?.toISOString() ?? null,
      liveSubmittedAt: deliverable.liveSubmittedAt?.toISOString() ?? null,
      proofReviewedAt: deliverable.proofReviewedAt?.toISOString() ?? null,
      participationId: deliverable.participationId,
      rejectionHistory: this.formatRejectionHistory(
        deliverable.rejectionEvents,
      ),
      campaign: {
        id: deliverable.participation.campaign.id,
        title: deliverable.participation.campaign.title,
        status: deliverable.participation.campaign.status,
        ratePer1kDisplay: `₹${deliverable.participation.campaign.ratePer1kPaise / 100} / 1K views`,
        budgetPaise: deliverable.participation.campaign.budgetPaise,
      },
      creator: deliverable.participation.creator,
      creatorProfile: {
        id: deliverable.participation.creatorProfile.id,
        platform: deliverable.participation.creatorProfile.platform,
        handle: deliverable.participation.creatorProfile.handle,
        label: deliverable.participation.creatorProfile.label,
        avatarUrl: deliverable.participation.creatorProfile.avatarUrl,
      },
      siblingDeliverables: deliverable.participation.deliverables.map((s) => ({
        id: s.id,
        platform: s.platform,
        status: s.status,
        draftDriveUrl: s.draftDriveUrl,
        rejectionReason: s.rejectionReason,
      })),
    };
  }

  async reviewDeliverable(
    userId: string,
    role: UserRole,
    deliverableId: string,
    action: ReviewDeliverableAction,
    rejectionReason?: string,
  ) {
    const deliverable = await this.prisma.formatDeliverable.findFirst({
      where: { id: deliverableId },
      include: {
        participation: { include: { campaign: true } },
      },
    });

    if (!deliverable) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Deliverable not found",
      });
    }

    await this.campaignAccess.assertCanAccessCampaign(
      userId,
      role,
      deliverable.participation.campaign,
      { requireWrite: true },
    );

    if (deliverable.status !== FormatDeliverableStatus.under_review) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Deliverable is not in a reviewable state",
      });
    }

    if (action === ReviewDeliverableAction.approve) {
      const updated = await this.prisma.formatDeliverable.update({
        where: { id: deliverableId },
        data: {
          status: FormatDeliverableStatus.draft_approved,
          draftReviewedAt: new Date(),
          reviewedByUserId: userId,
          rejectionReason: null,
        },
      });
      this.realtime.emitDeliverableReviewed(
        this.deliverableEventPayload(updated, deliverable.participation),
      );
      await this.activityLog.log(userId, "submission.approved", {
        targetType: "FormatDeliverable",
        targetId: updated.id,
        brandProfileId: deliverable.participation.campaign.brandProfileId ?? undefined,
        metadata: { campaignTitle: deliverable.participation.campaign.title, platform: updated.platform },
      });
      await this.notifications.create(deliverable.participation.creatorId, "creator", {
        type: "draft_approved",
        title: "Draft approved 🎉",
        body: `Your ${formatPlatform(updated.platform)} draft for ${deliverable.participation.campaign.title} was approved. Post it live and submit the link to get paid.`,
        link: `/participations/${deliverable.participation.id}`,
      });
      return { id: updated.id, status: updated.status };
    }

    if (!rejectionReason?.trim()) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "rejectionReason required when rejecting",
      });
    }

    const trimmedReason = rejectionReason.trim();
    const priorEvents = await this.prisma.deliverableRejectionEvent.findMany({
      where: { deliverableId },
      select: { rejectionReason: true },
    });

    if (
      isDuplicateRejectionReason(
        trimmedReason,
        priorEvents.map((e) => e.rejectionReason),
      )
    ) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message:
          "This rejection reason was already used for this format. Update your feedback or approve if the issue is resolved.",
      });
    }

    const draftDriveUrl = deliverable.draftDriveUrl?.trim() ?? "";
    const reviewedAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.deliverableRejectionEvent.create({
        data: {
          deliverableId,
          draftDriveUrl,
          rejectionReason: trimmedReason,
          reviewedByUserId: userId,
        },
      });

      return tx.formatDeliverable.update({
        where: { id: deliverableId },
        data: {
          status: FormatDeliverableStatus.draft_rejected,
          rejectionReason: trimmedReason,
          draftReviewedAt: reviewedAt,
          reviewedByUserId: userId,
        },
      });
    });

    this.realtime.emitDeliverableReviewed(
      this.deliverableEventPayload(updated, deliverable.participation),
    );
    await this.activityLog.log(userId, "submission.rejected", {
      targetType: "FormatDeliverable",
      targetId: updated.id,
      brandProfileId: deliverable.participation.campaign.brandProfileId ?? undefined,
      metadata: { campaignTitle: deliverable.participation.campaign.title, platform: updated.platform, reason: trimmedReason },
    });
    await this.notifications.create(deliverable.participation.creatorId, "creator", {
      type: "draft_rejected",
      title: "Draft needs changes",
      body: `Your ${formatPlatform(updated.platform)} draft for ${deliverable.participation.campaign.title} needs changes: ${trimmedReason}`,
      link: `/participations/${deliverable.participation.id}`,
    });
    return { id: updated.id, status: updated.status };
  }

  async countUnderReviewForCreator(creatorId: string, creatorProfileId?: string): Promise<number> {
    return this.prisma.formatDeliverable.count({
      where: {
        status: FormatDeliverableStatus.under_review,
        participation: { creatorId, ...(creatorProfileId ? { creatorProfileId } : {}) },
      },
    });
  }

  async getLeaderboard(
    campaignId: string,
    currentCreatorProfileId?: string,
    limit = 20,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { ratePer1kPaise: true, maxPayoutPaise: true },
    });
    if (!campaign) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Campaign not found" });
    }

    const participations = await this.prisma.campaignParticipation.findMany({
      where: { campaignId },
      include: {
        creator: {
          select: { id: true, displayName: true, username: true, avatarUrl: true },
        },
        creatorProfile: {
          select: { id: true, platform: true, handle: true, label: true },
        },
        deliverables: { select: { viewCount: true, paidAmountPaise: true } },
      },
    });

    // Each linked profile competes independently, so the same person can
    // appear more than once here (once per profile that joined).
    const entries = participations.map((p) => {
      const totalViews = p.deliverables.reduce((sum, d) => sum + d.viewCount, 0);
      const totalEarnedPaise = p.deliverables.reduce(
        (sum, d) =>
          sum +
          (d.paidAmountPaise ??
            computeEstimatedPaise(d.viewCount, campaign.ratePer1kPaise, campaign.maxPayoutPaise)),
        0,
      );
      return {
        creatorId: p.creator.id,
        creatorProfileId: p.creatorProfile.id,
        displayName:
          p.creatorProfile.label ??
          p.creator.displayName ??
          p.creator.username ??
          "Creator",
        handle: p.creatorProfile.handle,
        platform: p.creatorProfile.platform,
        avatarUrl: p.creator.avatarUrl,
        totalViews,
        totalEarnedPaise,
      };
    });

    entries.sort((a, b) => b.totalViews - a.totalViews);
    const ranked = entries.map((e, i) => ({ ...e, rank: i + 1 }));
    const currentUser = currentCreatorProfileId
      ? ranked.find((e) => e.creatorProfileId === currentCreatorProfileId) ?? null
      : null;

    return {
      campaignId,
      totalParticipants: ranked.length,
      entries: ranked.slice(0, limit),
      currentUser,
    };
  }

  async getOverallLeaderboard(currentUserId: string, limit = 20) {
    const participations = await this.prisma.campaignParticipation.findMany({
      include: {
        creator: {
          select: { id: true, displayName: true, username: true, avatarUrl: true },
        },
        campaign: { select: { ratePer1kPaise: true, maxPayoutPaise: true } },
        deliverables: { select: { viewCount: true, paidAmountPaise: true } },
      },
    });

    const byCreator = new Map<
      string,
      {
        creatorId: string;
        displayName: string;
        avatarUrl: string | null;
        totalViews: number;
        totalEarnedPaise: number;
      }
    >();

    for (const p of participations) {
      const totalViews = p.deliverables.reduce((sum, d) => sum + d.viewCount, 0);
      const totalEarnedPaise = p.deliverables.reduce(
        (sum, d) =>
          sum +
          (d.paidAmountPaise ??
            computeEstimatedPaise(
              d.viewCount,
              p.campaign.ratePer1kPaise,
              p.campaign.maxPayoutPaise,
            )),
        0,
      );

      const existing = byCreator.get(p.creatorId);
      if (existing) {
        existing.totalViews += totalViews;
        existing.totalEarnedPaise += totalEarnedPaise;
      } else {
        byCreator.set(p.creatorId, {
          creatorId: p.creator.id,
          displayName: p.creator.displayName ?? p.creator.username ?? "Creator",
          avatarUrl: p.creator.avatarUrl,
          totalViews,
          totalEarnedPaise,
        });
      }
    }

    const entries = [...byCreator.values()];
    entries.sort((a, b) => b.totalViews - a.totalViews);
    const ranked = entries.map((e, i) => ({ ...e, rank: i + 1 }));
    const currentUser = ranked.find((e) => e.creatorId === currentUserId) ?? null;

    return {
      totalParticipants: ranked.length,
      entries: ranked.slice(0, limit),
      currentUser,
    };
  }

  async approveProof(userId: string, role: UserRole, deliverableId: string) {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: { participation: { include: { campaign: true } } },
    });

    if (!deliverable) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Deliverable not found" });
    }

    await this.campaignAccess.assertCanAccessCampaign(
      userId,
      role,
      deliverable.participation.campaign,
      { requireWrite: true },
    );

    const reviewable: FormatDeliverableStatus[] = [
      FormatDeliverableStatus.proof_under_review,
      FormatDeliverableStatus.live_submitted,
    ];
    if (!reviewable.includes(deliverable.status)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Proof can only be approved when it is under review",
      });
    }

    const updated = await this.prisma.formatDeliverable.update({
      where: { id: deliverableId },
      data: {
        status: FormatDeliverableStatus.proof_approved,
        proofReviewedAt: new Date(),
        reviewedByUserId: userId,
      },
    });

    this.realtime.emitDeliverableLiveProof(
      this.deliverableEventPayload(updated, deliverable.participation),
    );
    await this.activityLog.log(userId, "proof.approved", {
      targetType: "FormatDeliverable",
      targetId: updated.id,
      brandProfileId: deliverable.participation.campaign.brandProfileId ?? undefined,
      metadata: { campaignTitle: deliverable.participation.campaign.title, platform: updated.platform },
    });
    await this.notifications.create(deliverable.participation.creatorId, "creator", {
      type: "proof_approved",
      title: "Proof approved — payout on the way",
      body: `Your live ${formatPlatform(updated.platform)} post for ${deliverable.participation.campaign.title} was verified. Payout will be processed shortly.`,
      link: `/participations/${deliverable.participation.id}`,
    });

    return { id: updated.id, status: updated.status };
  }

  async rejectProof(userId: string, role: UserRole, deliverableId: string, reason: string) {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: { participation: { include: { campaign: true } } },
    });

    if (!deliverable) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Deliverable not found" });
    }

    await this.campaignAccess.assertCanAccessCampaign(
      userId,
      role,
      deliverable.participation.campaign,
      { requireWrite: true },
    );

    const updated = await this.prisma.formatDeliverable.update({
      where: { id: deliverableId },
      data: {
        status: FormatDeliverableStatus.proof_rejected,
        rejectionReason: reason,
        proofReviewedAt: new Date(),
        reviewedByUserId: userId,
      },
    });

    this.realtime.emitDeliverableLiveProof(
      this.deliverableEventPayload(updated, deliverable.participation),
    );
    await this.activityLog.log(userId, "proof.rejected", {
      targetType: "FormatDeliverable",
      targetId: updated.id,
      brandProfileId: deliverable.participation.campaign.brandProfileId ?? undefined,
      metadata: { campaignTitle: deliverable.participation.campaign.title, platform: updated.platform, reason },
    });
    await this.notifications.create(deliverable.participation.creatorId, "creator", {
      type: "proof_rejected",
      title: "Proof rejected",
      body: `Your live ${formatPlatform(updated.platform)} post for ${deliverable.participation.campaign.title} was rejected: ${reason}`,
      link: `/participations/${deliverable.participation.id}`,
    });

    return { id: updated.id, status: updated.status };
  }

  async refreshDeliverableViews(creatorId: string, deliverableId: string) {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: { participation: { include: { campaign: true } } },
    });

    if (!deliverable || deliverable.participation.creatorId !== creatorId) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Deliverable not found" });
    }

    const proofStatuses: FormatDeliverableStatus[] = [
      FormatDeliverableStatus.proof_under_review,
      FormatDeliverableStatus.proof_approved,
      FormatDeliverableStatus.live_submitted,
    ];
    if (!proofStatuses.includes(deliverable.status) || !deliverable.livePostUrl) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Views can only be refreshed after live proof is submitted",
      });
    }

    const metrics = await this.apify.getViewCount(deliverable.livePostUrl);

    const updated = await this.prisma.formatDeliverable.update({
      where: { id: deliverableId },
      data: {
        viewCount:    metrics.viewCount,
        reach:        metrics.reach,
        likeCount:    metrics.likeCount,
        commentCount: metrics.commentCount,
        shareCount:   metrics.shareCount,
      },
    });

    // Auto-pause if the campaign budget pool is now full; emit update either way
    // so brand portal pool bars refresh in real time after every view sync.
    const wasPaused = await this._autoPauseCampaignIfPoolFull(deliverable.participation.campaign);
    if (!wasPaused) {
      this.realtime.emitCampaignUpdated({
        id: deliverable.participation.campaign.id,
        brandProfileId: deliverable.participation.campaign.brandProfileId,
      });
    }

    return {
      id:           updated.id,
      viewCount:    updated.viewCount,
      reach:        updated.reach,
      likeCount:    updated.likeCount,
      commentCount: updated.commentCount,
      shareCount:   updated.shareCount,
    };
  }

  private async _autoPauseCampaignIfPoolFull(campaign: {
    id: string;
    status: CampaignStatus;
    budgetPaise: number;
    brandProfileId: string | null;
  }): Promise<boolean> {
    if (campaign.status !== CampaignStatus.live || campaign.budgetPaise <= 0) return false;

    const rows = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(
        COALESCE(
          fd.paid_amount_paise,
          LEAST(
            FLOOR(fd.view_count::numeric * c.rate_per_1k_paise::numeric / 1000),
            c.max_payout_paise::numeric
          )
        )
      ), 0) AS total
      FROM campaign_participations cp
      JOIN format_deliverables fd ON fd.participation_id = cp.id
      JOIN campaigns c ON c.id = cp.campaign_id
      WHERE cp.campaign_id = ${campaign.id}
    `;

    const budgetUsed = Number(rows[0]?.total ?? 0);
    if (budgetUsed < campaign.budgetPaise) return false;

    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.paused },
    });

    this.realtime.emitCampaignUpdated({
      id: campaign.id,
      status: CampaignStatus.paused,
      brandProfileId: campaign.brandProfileId,
    });

    return true;
  }

  async countPendingReviewsForBrand(
    userId: string,
    role: UserRole,
  ): Promise<number> {
    const brandProfileIds = await this.resolveBrandProfileIds(userId, role);
    if (brandProfileIds && brandProfileIds.length === 0) {
      return 0;
    }

    return this.prisma.formatDeliverable.count({
      where: {
        status: FormatDeliverableStatus.under_review,
        ...(brandProfileIds
          ? {
              participation: {
                campaign: { brandProfileId: { in: brandProfileIds } },
              },
            }
          : {}),
      },
    });
  }
}
