import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  CampaignStatus,
  FormatDeliverableStatus,
  UserRole,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParticipationService } from "./participation.service";
import { ReviewDeliverableAction } from "./dto/review-deliverable.dto";

function makePrisma() {
  return {
    campaign: { findFirst: vi.fn() },
    campaignParticipation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    formatDeliverable: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    deliverableRejectionEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

function makeCampaignAccess() {
  return {
    getBrandProfileIdForUser: vi.fn(),
    assertCanAccessCampaign: vi.fn(),
  };
}

function makeRealtime() {
  return {
    emitParticipationJoined: vi.fn(),
    emitDeliverableSubmitted: vi.fn(),
    emitDeliverableReviewed: vi.fn(),
    emitDeliverableLiveProof: vi.fn(),
  };
}

describe("ParticipationService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let campaignAccess: ReturnType<typeof makeCampaignAccess>;
  let realtime: ReturnType<typeof makeRealtime>;
  let service: ParticipationService;

  beforeEach(() => {
    prisma = makePrisma();
    campaignAccess = makeCampaignAccess();
    realtime = makeRealtime();
    service = new ParticipationService(
      prisma as never,
      campaignAccess as never,
      realtime as never,
    );
  });

  describe("joinCampaign", () => {
    it("creates participation with deliverables per platform", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: "camp-1",
        status: CampaignStatus.live,
        platforms: ["instagram_reel", "youtube_shorts"],
        platform: "instagram_reel",
        brandProfileId: "brand-1",
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue(null);
      prisma.campaignParticipation.create.mockResolvedValue({
        id: "part-1",
        campaignId: "camp-1",
        creatorId: "creator-1",
        platformsSnapshot: ["instagram_reel", "youtube_shorts"],
        joinedAt: new Date("2026-06-09"),
        campaign: {
          id: "camp-1",
          title: "Test",
          status: CampaignStatus.live,
          platforms: ["instagram_reel", "youtube_shorts"],
          platform: "instagram_reel",
          ratePer1kPaise: 5000,
          maxPayoutPaise: 100000,
          brandProfile: { companyName: "Brand", logoUrl: null },
        },
        deliverables: [
          {
            id: "d1",
            platform: "instagram_reel",
            status: FormatDeliverableStatus.draft_pending,
            draftDriveUrl: null,
            livePostUrl: null,
            rejectionReason: null,
            draftSubmittedAt: null,
            draftReviewedAt: null,
            liveSubmittedAt: null,
            rejectionEvents: [],
          },
          {
            id: "d2",
            platform: "youtube_shorts",
            status: FormatDeliverableStatus.draft_pending,
            draftDriveUrl: null,
            livePostUrl: null,
            rejectionReason: null,
            draftSubmittedAt: null,
            draftReviewedAt: null,
            liveSubmittedAt: null,
            rejectionEvents: [],
          },
        ],
      });

      const result = await service.joinCampaign("creator-1", "camp-1");

      expect(result.id).toBe("part-1");
      expect(result.deliverables).toHaveLength(2);
      expect(prisma.campaignParticipation.create).toHaveBeenCalled();
      expect(realtime.emitParticipationJoined).toHaveBeenCalled();
    });

    it("throws conflict when already joined", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: "camp-1",
        status: CampaignStatus.live,
        platforms: ["instagram_reel"],
        platform: "instagram_reel",
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue({
        id: "part-existing",
        campaignId: "camp-1",
        creatorId: "creator-1",
        platformsSnapshot: ["instagram_reel"],
        joinedAt: new Date(),
        campaign: {
          id: "camp-1",
          title: "Test",
          status: CampaignStatus.live,
          platforms: ["instagram_reel"],
          platform: "instagram_reel",
          ratePer1kPaise: 5000,
          maxPayoutPaise: 100000,
          brandProfile: null,
        },
        deliverables: [],
      });

      await expect(
        service.joinCampaign("creator-1", "camp-1"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("throws not found for non-live campaign", async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);
      await expect(
        service.joinCampaign("creator-1", "camp-1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("submitDraft", () => {
    it("moves rejected deliverable back to under_review", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.draft_rejected,
        rejectionEvents: [
          {
            draftDriveUrl: "https://drive.google.com/file/d/old/view",
          },
        ],
        participation: {
          creatorId: "creator-1",
          campaignId: "camp-1",
          campaign: { status: CampaignStatus.live, brandProfileId: "brand-1" },
        },
        participationId: "part-1",
        platform: "instagram_reel",
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.under_review,
        draftDriveUrl: "https://drive.google.com/file/d/abc/view",
        participationId: "part-1",
        platform: "instagram_reel",
      });

      const result = await service.submitDraft("creator-1", "d1", {
        draftDriveUrl: "https://drive.google.com/file/d/abc/view",
      });

      expect(result.status).toBe(FormatDeliverableStatus.under_review);
      expect(realtime.emitDeliverableSubmitted).toHaveBeenCalled();
    });

    it("rejects non-Google Drive URLs", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.draft_pending,
        participation: {
          creatorId: "creator-1",
          campaign: { status: CampaignStatus.live },
        },
      });

      await expect(
        service.submitDraft("creator-1", "d1", {
          draftDriveUrl: "https://dropbox.com/s/abc",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("blocks resubmit with same Drive URL as last rejection", async () => {
      const rejectedUrl = "https://drive.google.com/file/d/same/view";
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.draft_rejected,
        rejectionEvents: [{ draftDriveUrl: rejectedUrl }],
        participation: {
          creatorId: "creator-1",
          campaign: { status: CampaignStatus.live },
        },
      });

      await expect(
        service.submitDraft("creator-1", "d1", {
          draftDriveUrl: rejectedUrl,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("blocks draft submit when campaign is closed", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.draft_pending,
        participation: {
          creatorId: "creator-1",
          campaign: { status: CampaignStatus.paused },
        },
      });

      await expect(
        service.submitDraft("creator-1", "d1", {
          draftDriveUrl: "https://drive.google.com/a",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("submitLiveProof", () => {
    it("blocks live proof before approval", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.under_review,
        participation: {
          creatorId: "creator-1",
          campaign: { status: CampaignStatus.live },
        },
      });

      await expect(
        service.submitLiveProof("creator-1", "d1", {
          livePostUrl: "https://instagram.com/reel/1",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts live proof when draft_approved", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.draft_approved,
        participation: {
          creatorId: "creator-1",
          campaign: { status: CampaignStatus.live },
        },
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.live_submitted,
        livePostUrl: "https://instagram.com/reel/1",
      });

      const result = await service.submitLiveProof("creator-1", "d1", {
        livePostUrl: "https://instagram.com/reel/1",
      });

      expect(result.status).toBe(FormatDeliverableStatus.live_submitted);
    });
  });

  describe("reviewDeliverable", () => {
    it("approves under_review deliverable", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.under_review,
        participation: { campaign: { id: "camp-1" } },
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.draft_approved,
        participationId: "part-1",
        platform: "instagram_reel",
      });

      const result = await service.reviewDeliverable(
        "brand-1",
        UserRole.brand,
        "d1",
        ReviewDeliverableAction.approve,
      );

      expect(result.status).toBe(FormatDeliverableStatus.draft_approved);
      expect(campaignAccess.assertCanAccessCampaign).toHaveBeenCalled();
      expect(realtime.emitDeliverableReviewed).toHaveBeenCalled();
    });

    it("requires rejection reason on reject", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.under_review,
        participation: { campaign: { id: "camp-1" } },
      });

      await expect(
        service.reviewDeliverable(
          "brand-1",
          UserRole.brand,
          "d1",
          ReviewDeliverableAction.reject,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("creates rejection history on reject", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.under_review,
        draftDriveUrl: "https://drive.google.com/file/d/abc/view",
        participation: {
          campaign: { id: "camp-1" },
          campaignId: "camp-1",
          creatorId: "creator-1",
        },
        participationId: "part-1",
        platform: "instagram_reel",
      });
      prisma.deliverableRejectionEvent.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          deliverableRejectionEvent: { create: vi.fn() },
          formatDeliverable: {
            update: vi.fn().mockResolvedValue({
              id: "d1",
              status: FormatDeliverableStatus.draft_rejected,
              participationId: "part-1",
              platform: "instagram_reel",
            }),
          },
        };
        return fn(tx);
      });

      const result = await service.reviewDeliverable(
        "brand-1",
        UserRole.brand,
        "d1",
        ReviewDeliverableAction.reject,
        "Wrong aspect ratio",
      );

      expect(result.status).toBe(FormatDeliverableStatus.draft_rejected);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("blocks duplicate rejection reason", async () => {
      prisma.formatDeliverable.findFirst.mockResolvedValue({
        id: "d1",
        status: FormatDeliverableStatus.under_review,
        draftDriveUrl: "https://drive.google.com/file/d/abc/view",
        participation: { campaign: { id: "camp-1" } },
      });
      prisma.deliverableRejectionEvent.findMany.mockResolvedValue([
        { rejectionReason: "Wrong aspect ratio" },
      ]);

      await expect(
        service.reviewDeliverable(
          "brand-1",
          UserRole.brand,
          "d1",
          ReviewDeliverableAction.reject,
          "wrong  aspect ratio",
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
