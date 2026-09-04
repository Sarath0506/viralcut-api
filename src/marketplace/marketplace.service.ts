import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CampaignStatus, FormatDeliverableStatus } from "@prisma/client";

import type { Env } from "../config/env";
import { InstagramOAuthService } from "../creator-profiles/instagram-oauth.service";
import { YoutubeOAuthService } from "../creator-profiles/youtube-oauth.service";
import { FILLABLE_DELIVERABLE_STATUSES } from "../participation/deliverable-status";
import { isUploadedFileUrl } from "../participation/drive-url";
import { ParticipationService } from "../participation/participation.service";
import { PrismaService } from "../prisma/prisma.service";

type PublishResult = { permalink: string };

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly participation: ParticipationService,
    private readonly instagramOAuth: InstagramOAuthService,
    private readonly youtubeOAuth: YoutubeOAuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Listings a creator can browse for a campaign they've already joined —
   * reuses ParticipationService.getParticipationByCampaign purely as the
   * "already joined" gate (it throws NotFoundException otherwise), the
   * same check `joinCampaign` itself relies on. */
  async listBrowsableListings(
    creatorId: string,
    campaignId: string,
    creatorProfileId: string,
  ) {
    await this.participation.getParticipationByCampaign(
      creatorId,
      campaignId,
      creatorProfileId,
    );

    const listings = await this.prisma.formatDeliverable.findMany({
      where: {
        listedInMarketplace: true,
        delistedAt: null,
        status: FormatDeliverableStatus.proof_approved,
        participation: {
          campaignId,
          creatorId: { not: creatorId },
        },
      },
      include: {
        participation: {
          include: {
            creator: { select: { displayName: true, username: true, avatarUrl: true } },
            campaign: { select: { maxRepostsPerClip: true } },
          },
        },
        _count: { select: { marketplaceListingReposts: true } },
      },
      orderBy: { liveSubmittedAt: "desc" },
    });

    return listings
      .filter((d) => {
        const cap = d.participation.campaign.maxRepostsPerClip;
        return cap == null || d._count.marketplaceListingReposts < cap;
      })
      .map((d) => ({
        sourceDeliverableId: d.id,
        platform: d.platform,
        mediaUrl: d.draftDriveUrl,
        viewCount: d.viewCount,
        likeCount: d.likeCount,
        creatorName:
          d.participation.creator.displayName ??
          d.participation.creator.username ??
          "Creator",
        creatorAvatarUrl: d.participation.creator.avatarUrl,
        repostCount: d._count.marketplaceListingReposts,
        maxRepostsPerClip: d.participation.campaign.maxRepostsPerClip,
      }));
  }

  /** Fills the requesting creator's own (still-open) per-platform deliverable
   * slot for this campaign with a marketplace listing's already-approved
   * content: publishes it to their connected account for that platform,
   * then records the claim. B's earnings are never special-cased — the
   * resulting deliverable goes through the exact same view-tracking,
   * payout-cap, and proof-review path as any organic submission; the split
   * only happens later, at payout time. */
  async createRepost(
    creatorId: string,
    sourceDeliverableId: string,
    creatorProfileId: string,
  ) {
    const source = await this.prisma.formatDeliverable.findUnique({
      where: { id: sourceDeliverableId },
      include: { participation: { include: { campaign: true } } },
    });
    if (!source) {
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Marketplace listing not found",
      });
    }

    const { campaign } = source.participation;

    if (
      !source.listedInMarketplace ||
      source.delistedAt ||
      source.status !== FormatDeliverableStatus.proof_approved
    ) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "This clip is not available in the marketplace",
      });
    }

    if (campaign.status !== CampaignStatus.live) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Campaign is not open for submissions",
      });
    }

    if (source.participation.creatorId === creatorId) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "You can't repost your own clip",
      });
    }

    if (campaign.maxRepostsPerClip != null) {
      const repostCount = await this.prisma.marketplaceRepost.count({
        where: { sourceDeliverableId },
      });
      if (repostCount >= campaign.maxRepostsPerClip) {
        throw new ConflictException({
          code: "REPOST_CAP_REACHED",
          message: "This clip has reached its repost limit",
        });
      }
    }

    if (!source.draftDriveUrl || !isUploadedFileUrl(source.draftDriveUrl)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "This listing's media isn't available for reposting",
      });
    }

    // Reuses the same "already joined" gate as browse, and gives us the
    // poster's own per-platform deliverable slots without a second query.
    const posterParticipation = await this.participation.getParticipationByCampaign(
      creatorId,
      campaign.id,
      creatorProfileId,
    );
    const posterSlot = posterParticipation.deliverables.find(
      (d) => d.platform === source.platform,
    );
    if (!posterSlot || !FILLABLE_DELIVERABLE_STATUSES.includes(posterSlot.status)) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "You don't have an open slot for this platform in this campaign",
      });
    }

    const publishResult = await this.publishToPlatform(
      source.platform,
      creatorProfileId,
      source.draftDriveUrl,
      campaign.title,
    );

    const [updatedDeliverable, repost] = await this.prisma.$transaction([
      this.prisma.formatDeliverable.update({
        where: { id: posterSlot.id },
        data: {
          livePostUrl: publishResult.permalink,
          liveSubmittedAt: new Date(),
          status: FormatDeliverableStatus.proof_under_review,
        },
      }),
      this.prisma.marketplaceRepost.create({
        data: {
          sourceDeliverableId: source.id,
          posterDeliverableId: posterSlot.id,
          posterCreatorId: creatorId,
        },
      }),
    ]);

    return {
      deliverableId: updatedDeliverable.id,
      status: updatedDeliverable.status,
      livePostUrl: updatedDeliverable.livePostUrl,
      repostId: repost.id,
    };
  }

  /** Admin takedown: hides the listing from future browse/repost results.
   * Existing MarketplaceRepost rows and any wallet transactions they've
   * already produced are left untouched — this only stops new reposts. */
  async delistListing(deliverableId: string) {
    const updated = await this.prisma.formatDeliverable
      .update({
        where: { id: deliverableId },
        data: { delistedAt: new Date() },
      })
      .catch((e) => {
        if (e.code === "P2025") {
          throw new NotFoundException({ code: "NOT_FOUND", message: "Deliverable not found" });
        }
        throw e;
      });

    return { id: updated.id, delistedAt: updated.delistedAt };
  }

  private async publishToPlatform(
    platform: string,
    creatorProfileId: string,
    videoUrl: string,
    title: string,
  ): Promise<PublishResult> {
    if (platform === "instagram_reel" || platform === "instagram_post") {
      if (!this.config.get("INSTAGRAM_PUBLISHING_ENABLED", { infer: true })) {
        throw new BadRequestException({
          code: "PUBLISHING_DISABLED",
          message: "Instagram publishing isn't enabled yet",
        });
      }
      return this.instagramOAuth.publishReel(creatorProfileId, videoUrl, title);
    }

    if (platform === "youtube_shorts") {
      if (!this.config.get("YOUTUBE_PUBLISHING_ENABLED", { infer: true })) {
        throw new BadRequestException({
          code: "PUBLISHING_DISABLED",
          message: "YouTube publishing isn't enabled yet",
        });
      }
      return this.youtubeOAuth.uploadShort(creatorProfileId, videoUrl, title);
    }

    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: `Reposting isn't supported for platform ${platform} yet`,
    });
  }
}
