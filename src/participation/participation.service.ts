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

import { CampaignAccessService } from "../access/campaign-access.service";
import { normalizeCampaignPlatforms } from "../campaigns/campaign-platforms";
import { ApifyService } from "../common/apify.service";
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

  async joinCampaign(creatorId: string, campaignId: string) {
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
        campaignId_creatorId: { campaignId, creatorId },
      },
      include: participationInclude,
    });
    if (existing) {
      throw new ConflictException({
        code: "ALREADY_JOINED",
        message: "Already joined this campaign",
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

  async getParticipationByCampaign(creatorId: string, campaignId: string) {
    const participation = await this.loadParticipation({
      campaignId,
      creatorId,
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

  async listForCreator(creatorId: string, tab: "active" | "completed" = "active") {
    const participations = await this.prisma.campaignParticipation.findMany({
      where: { creatorId },
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
            campaign: { select: { id: true, title: true } },
            creator: {
              select: { id: true, displayName: true, username: true },
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

    return deliverables.map((d) => ({
      id: d.id,
      platform: d.platform,
      status: d.status,
      draftDriveUrl: d.draftDriveUrl,
      draftSubmittedAt: d.draftSubmittedAt?.toISOString() ?? null,
      campaignId: d.participation.campaign.id,
      campaignTitle: d.participation.campaign.title,
      participationId: d.participationId,
      creatorName:
        d.participation.creator.displayName ??
        d.participation.creator.username ??
        "Creator",
      priorRejectionCount: d._count.rejectionEvents,
      siblingDeliverables: d.participation.deliverables.map((s) => ({
        id: s.id,
        platform: s.platform,
        status: s.status,
      })),
    }));
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
      participationId: deliverable.participationId,
      rejectionHistory: this.formatRejectionHistory(
        deliverable.rejectionEvents,
      ),
      campaign: {
        id: deliverable.participation.campaign.id,
        title: deliverable.participation.campaign.title,
        ratePer1kDisplay: `₹${deliverable.participation.campaign.ratePer1kPaise / 100} / 1K views`,
      },
      creator: deliverable.participation.creator,
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
    return { id: updated.id, status: updated.status };
  }

  async countUnderReviewForCreator(creatorId: string): Promise<number> {
    return this.prisma.formatDeliverable.count({
      where: {
        status: FormatDeliverableStatus.under_review,
        participation: { creatorId },
      },
    });
  }

  async approveProof(adminUserId: string, deliverableId: string) {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: { participation: { include: { campaign: true } } },
    });

    if (!deliverable) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Deliverable not found" });
    }

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
        reviewedByUserId: adminUserId,
      },
    });

    this.realtime.emitDeliverableLiveProof(
      this.deliverableEventPayload(updated, deliverable.participation),
    );

    return { id: updated.id, status: updated.status };
  }

  async rejectProof(adminUserId: string, deliverableId: string, reason: string) {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: { participation: { include: { campaign: true } } },
    });

    if (!deliverable) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Deliverable not found" });
    }

    const updated = await this.prisma.formatDeliverable.update({
      where: { id: deliverableId },
      data: {
        status: FormatDeliverableStatus.proof_rejected,
        rejectionReason: reason,
        proofReviewedAt: new Date(),
        reviewedByUserId: adminUserId,
      },
    });

    this.realtime.emitDeliverableLiveProof(
      this.deliverableEventPayload(updated, deliverable.participation),
    );

    return { id: updated.id, status: updated.status };
  }

  async refreshDeliverableViews(creatorId: string, deliverableId: string) {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: { participation: true },
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

    return {
      id:           updated.id,
      viewCount:    updated.viewCount,
      reach:        updated.reach,
      likeCount:    updated.likeCount,
      commentCount: updated.commentCount,
      shareCount:   updated.shareCount,
    };
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
