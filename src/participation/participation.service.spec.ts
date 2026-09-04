import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  CampaignStatus,
  FormatDeliverableStatus,
  NewClipperIntakeStatus,
  UserRole,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParticipationService } from "./participation.service";
import { ReviewDeliverableAction } from "./dto/review-deliverable.dto";

function makePrisma() {
  return {
    campaign: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    campaignParticipation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    formatDeliverable: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    deliverableRejectionEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ total: 0n }]),
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
    emitCampaignUpdated: vi.fn(),
  };
}

function makeCreatorProfiles() {
  return {
    assertOwnership: vi.fn().mockResolvedValue({ id: "profile-1", userId: "creator-1" }),
  };
}

describe("ParticipationService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let campaignAccess: ReturnType<typeof makeCampaignAccess>;
  let realtime: ReturnType<typeof makeRealtime>;
  let creatorProfiles: ReturnType<typeof makeCreatorProfiles>;
  let apify: { getViewCount: ReturnType<typeof vi.fn> };
  let service: ParticipationService;

  beforeEach(() => {
    prisma = makePrisma();
    campaignAccess = makeCampaignAccess();
    realtime = makeRealtime();
    creatorProfiles = makeCreatorProfiles();
    apify = { getViewCount: vi.fn().mockResolvedValue({ viewCount: 0, platform: "unknown" }) };
    service = new ParticipationService(
      prisma as never,
      campaignAccess as never,
      realtime as never,
      apify as never,
      { log: async () => undefined } as never,
      { create: async () => undefined } as never,
      creatorProfiles as never,
      { runPipeline: async () => undefined } as never,
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
        budgetPaise: 10000000,
        poolThresholdBps: 8000,
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue(null);
      prisma.campaignParticipation.create.mockResolvedValue({
        id: "part-1",
        campaignId: "camp-1",
        creatorId: "creator-1",
        creatorProfileId: "profile-1",
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
        creatorProfile: {
          id: "profile-1",
          platform: "instagram",
          handle: "demo_creator",
          label: null,
          avatarUrl: null,
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

      const result = await service.joinCampaign("creator-1", "camp-1", "profile-1");

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
        budgetPaise: 10000000,
        poolThresholdBps: 8000,
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue({
        id: "part-existing",
        campaignId: "camp-1",
        creatorId: "creator-1",
        creatorProfileId: "profile-1",
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
        creatorProfile: {
          id: "profile-1",
          platform: "instagram",
          handle: "demo_creator",
          label: null,
          avatarUrl: null,
        },
        deliverables: [],
      });

      await expect(
        service.joinCampaign("creator-1", "camp-1", "profile-1"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("throws not found for non-live campaign", async () => {
      prisma.campaign.findFirst.mockResolvedValue(null);
      await expect(
        service.joinCampaign("creator-1", "camp-1", "profile-1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("blocks joining when intake is closed_at_threshold", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: "camp-1",
        status: CampaignStatus.live,
        platforms: ["instagram_reel"],
        platform: "instagram_reel",
        newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold,
        budgetPaise: 10000000,
        poolThresholdBps: 8000,
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue(null);

      await expect(
        service.joinCampaign("creator-1", "camp-1", "profile-1"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.campaignParticipation.create).not.toHaveBeenCalled();
    });

    it("blocks joining once live pool usage crosses the threshold even if the stored status is still 'open'", async () => {
      // The stored newClipperIntakeStatus only flips reactively (normally on
      // a deliverable's view refresh) — a campaign whose pool crossed 80%
      // with no recent view refresh would still read "open" here. The join
      // path must re-check live usage rather than trust the stale field.
      prisma.campaign.findFirst.mockResolvedValue({
        id: "camp-1",
        status: CampaignStatus.live,
        platforms: ["instagram_reel"],
        platform: "instagram_reel",
        brandProfileId: "brand-1",
        newClipperIntakeStatus: NewClipperIntakeStatus.open,
        budgetPaise: 10000000,
        poolThresholdBps: 8000,
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue(null);
      prisma.$queryRaw.mockResolvedValue([{ total: 8400000n }]); // 84% of budgetPaise

      await expect(
        service.joinCampaign("creator-1", "camp-1", "profile-1"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.campaignParticipation.create).not.toHaveBeenCalled();
      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: "camp-1" },
        data: { newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold },
      });
      expect(realtime.emitCampaignUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "camp-1",
          newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold,
        }),
      );
    });

    it("allows joining under manually_extended and consumes one unit of the allowance", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: "camp-1",
        status: CampaignStatus.live,
        platforms: ["instagram_reel"],
        platform: "instagram_reel",
        newClipperIntakeStatus: NewClipperIntakeStatus.manually_extended,
        extraClipperAllowance: 3,
        budgetPaise: 10000000,
        poolThresholdBps: 8000,
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue(null);
      prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
      prisma.campaign.findUnique.mockResolvedValue({ extraClipperAllowance: 2 });
      prisma.campaignParticipation.create.mockResolvedValue({
        id: "part-1",
        campaignId: "camp-1",
        creatorId: "creator-1",
        creatorProfileId: "profile-1",
        platformsSnapshot: ["instagram_reel"],
        joinedAt: new Date("2026-06-09"),
        campaign: {
          id: "camp-1", title: "Test", status: CampaignStatus.live,
          platforms: ["instagram_reel"], platform: "instagram_reel",
          ratePer1kPaise: 5000, maxPayoutPaise: 100000, brandProfile: null,
        },
        creatorProfile: { id: "profile-1", platform: "instagram", handle: "demo_creator", label: null, avatarUrl: null },
        deliverables: [],
      });

      const result = await service.joinCampaign("creator-1", "camp-1", "profile-1");

      expect(result.id).toBe("part-1");
      expect(prisma.campaign.updateMany).toHaveBeenCalledWith({
        where: { id: "camp-1", extraClipperAllowance: { gt: 0 } },
        data: { extraClipperAllowance: { decrement: 1 } },
      });
      // Allowance still has 2 left after this join — intake stays manually_extended.
      expect(prisma.campaign.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold } }),
      );
    });

    it("closes intake again once the last manually_extended slot is used", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: "camp-1",
        status: CampaignStatus.live,
        platforms: ["instagram_reel"],
        platform: "instagram_reel",
        newClipperIntakeStatus: NewClipperIntakeStatus.manually_extended,
        extraClipperAllowance: 1,
        budgetPaise: 10000000,
        poolThresholdBps: 8000,
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue(null);
      prisma.campaign.updateMany.mockResolvedValue({ count: 1 });
      prisma.campaign.findUnique.mockResolvedValue({ extraClipperAllowance: 0 });
      prisma.campaignParticipation.create.mockResolvedValue({
        id: "part-1",
        campaignId: "camp-1",
        creatorId: "creator-1",
        creatorProfileId: "profile-1",
        platformsSnapshot: ["instagram_reel"],
        joinedAt: new Date("2026-06-09"),
        campaign: {
          id: "camp-1", title: "Test", status: CampaignStatus.live,
          platforms: ["instagram_reel"], platform: "instagram_reel",
          ratePer1kPaise: 5000, maxPayoutPaise: 100000, brandProfile: null,
        },
        creatorProfile: { id: "profile-1", platform: "instagram", handle: "demo_creator", label: null, avatarUrl: null },
        deliverables: [],
      });

      await service.joinCampaign("creator-1", "camp-1", "profile-1");

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: "camp-1" },
        data: { newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold },
      });
    });

    it("blocks joining when the manually_extended allowance is already exhausted (race lost)", async () => {
      prisma.campaign.findFirst.mockResolvedValue({
        id: "camp-1",
        status: CampaignStatus.live,
        platforms: ["instagram_reel"],
        platform: "instagram_reel",
        newClipperIntakeStatus: NewClipperIntakeStatus.manually_extended,
        extraClipperAllowance: 0,
        budgetPaise: 10000000,
        poolThresholdBps: 8000,
      });
      prisma.campaignParticipation.findUnique.mockResolvedValue(null);
      prisma.campaign.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.joinCampaign("creator-1", "camp-1", "profile-1"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.campaignParticipation.create).not.toHaveBeenCalled();
    });
  });

  describe("getLeaderboard", () => {
    it("ranks two profiles owned by the same user as independent entries", async () => {
      prisma.campaign.findUnique.mockResolvedValue({
        ratePer1kPaise: 5000,
        maxPayoutPaise: 100000,
      });
      prisma.campaignParticipation.findMany.mockResolvedValue([
        {
          creator: { id: "user-1", displayName: "Ravi", username: "ravi", avatarUrl: null },
          creatorProfile: { id: "profile-a", platform: "instagram", handle: "ravi_main", label: null },
          deliverables: [{ viewCount: 1000, paidAmountPaise: null }],
        },
        {
          creator: { id: "user-1", displayName: "Ravi", username: "ravi", avatarUrl: null },
          creatorProfile: { id: "profile-b", platform: "instagram", handle: "ravi_memes", label: "Meme page" },
          deliverables: [{ viewCount: 5000, paidAmountPaise: null }],
        },
      ]);

      const result = await service.getLeaderboard("camp-1", "profile-b");

      expect(result.totalParticipants).toBe(2);
      expect(result.entries.map((e) => e.creatorProfileId)).toEqual([
        "profile-b",
        "profile-a",
      ]);
      expect(result.currentUser?.creatorProfileId).toBe("profile-b");
      expect(result.currentUser?.displayName).toBe("Meme page");
    });

    it("returns null currentUser when no creatorProfileId is supplied", async () => {
      prisma.campaign.findUnique.mockResolvedValue({
        ratePer1kPaise: 5000,
        maxPayoutPaise: 100000,
      });
      prisma.campaignParticipation.findMany.mockResolvedValue([
        {
          creator: { id: "user-1", displayName: "Ravi", username: "ravi", avatarUrl: null },
          creatorProfile: { id: "profile-a", platform: "instagram", handle: "ravi_main", label: null },
          deliverables: [{ viewCount: 1000, paidAmountPaise: null }],
        },
      ]);

      const result = await service.getLeaderboard("camp-1");

      expect(result.currentUser).toBeNull();
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

  describe("refreshDeliverableViews", () => {
    function mockDeliverable(overrides: Partial<{ viewCount: number }> = {}) {
      const base = {
        id: "d1",
        creatorId: undefined as unknown, // set per-call below
        status: FormatDeliverableStatus.live_submitted,
        livePostUrl: "https://instagram.com/reel/1",
        participation: {
          creatorId: "creator-1",
          campaign: {
            id: "camp-1",
            status: CampaignStatus.live,
            budgetPaise: 1_000_000,
            brandProfileId: "brand-1",
            ratePer1kPaise: 1_000,
            maxPayoutPaise: 50_000,
            newClipperIntakeStatus: NewClipperIntakeStatus.open as NewClipperIntakeStatus,
            poolThresholdBps: 8000,
          },
        },
      };
      return { ...base, ...overrides };
    }

    it("reports payoutCapped: false when the estimate is under maxPayoutPaise", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(mockDeliverable());
      apify.getViewCount.mockResolvedValue({
        viewCount: 10_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0, platform: "instagram",
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        id: "d1", viewCount: 10_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0,
      });

      // 10_000 views * 1_000 paise/1k = 10_000 paise, well under the 50_000 cap.
      const result = await service.refreshDeliverableViews("creator-1", "d1");
      expect(result.payoutCapped).toBe(false);
    });

    it("reports payoutCapped: true once the estimate reaches maxPayoutPaise, even though views keep climbing", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(mockDeliverable());
      apify.getViewCount.mockResolvedValue({
        viewCount: 500_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0, platform: "instagram",
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        id: "d1", viewCount: 500_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0,
      });

      // 500_000 views * 1_000 paise/1k = 500_000 paise, far past the 50_000 cap.
      const result = await service.refreshDeliverableViews("creator-1", "d1");
      expect(result.payoutCapped).toBe(true);
      // Analytics themselves are never capped — the real view count is what was written.
      expect(result.viewCount).toBe(500_000);
    });

    it("closes intake at 80% pool utilization without pausing the campaign", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(mockDeliverable());
      apify.getViewCount.mockResolvedValue({
        viewCount: 1_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0, platform: "instagram",
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        id: "d1", viewCount: 1_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0,
      });
      // Pool is at 85% of the 1_000_000 paise budget — above the 8000bps (80%) threshold, below 100%.
      prisma.$queryRaw.mockResolvedValue([{ total: 850_000n }]);

      await service.refreshDeliverableViews("creator-1", "d1");

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: "camp-1" },
        data: { newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold },
      });
      expect(prisma.campaign.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: CampaignStatus.paused }) }),
      );
      expect(realtime.emitCampaignUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "camp-1",
          newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold,
          poolUtilizationBps: 8500,
        }),
      );
    });

    it("does not re-close intake if it was already manually_extended", async () => {
      const deliverable = mockDeliverable();
      deliverable.participation.campaign.newClipperIntakeStatus = NewClipperIntakeStatus.manually_extended;
      prisma.formatDeliverable.findUnique.mockResolvedValue(deliverable);
      apify.getViewCount.mockResolvedValue({
        viewCount: 1_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0, platform: "instagram",
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        id: "d1", viewCount: 1_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0,
      });
      prisma.$queryRaw.mockResolvedValue([{ total: 850_000n }]);

      await service.refreshDeliverableViews("creator-1", "d1");

      // Only the open -> closed_at_threshold transition is automatic; an
      // admin-extended campaign shouldn't be silently overridden by it.
      expect(prisma.campaign.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { newClipperIntakeStatus: NewClipperIntakeStatus.closed_at_threshold } }),
      );
    });

    it("still auto-pauses at 100% and reports paused status in the realtime payload", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(mockDeliverable());
      apify.getViewCount.mockResolvedValue({
        viewCount: 1_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0, platform: "instagram",
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        id: "d1", viewCount: 1_000, reach: 0, likeCount: 0, commentCount: 0, shareCount: 0,
      });
      prisma.$queryRaw.mockResolvedValue([{ total: 1_000_000n }]);

      await service.refreshDeliverableViews("creator-1", "d1");

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: "camp-1" },
        data: { status: CampaignStatus.paused },
      });
      expect(realtime.emitCampaignUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ id: "camp-1", status: CampaignStatus.paused, poolUtilizationBps: 10000 }),
      );
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
