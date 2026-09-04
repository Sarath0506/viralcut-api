import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutoReviewService } from "./auto-review.service";

function makePrisma() {
  return {
    formatDeliverable: { findUnique: vi.fn() },
    instagramConnection: { findUnique: vi.fn() },
    youtubeConnection: { findUnique: vi.fn() },
    autoReviewResult: { create: vi.fn() },
  };
}

function makeApify() {
  return {
    checkPostResolves: vi.fn().mockResolvedValue({ status: "resolved" }),
    getPostAuthor: vi.fn().mockResolvedValue(null),
    detectPlatform: vi.fn().mockReturnValue("instagram"),
    getLivePostMedia: vi.fn().mockResolvedValue(null),
  };
}

function makeGemini() {
  return {
    evaluateCompliance: vi.fn().mockResolvedValue(null),
    compareDraftToLive: vi.fn().mockResolvedValue(null),
  };
}

function makeChecklist() {
  return { getOrCreateChecklist: vi.fn().mockResolvedValue(null) };
}

function makeConfig(enabled: boolean) {
  return { get: vi.fn().mockReturnValue(enabled) };
}

const baseDeliverable = {
  id: "deliverable-1",
  platform: "instagram_reel",
  livePostUrl: "https://www.instagram.com/reel/abc123/",
  draftDriveUrl: null,
  participation: {
    creatorProfileId: "profile-1",
    campaign: { id: "campaign-1", brief: "brief", doRules: null, avoidRules: null },
  },
};

describe("AutoReviewService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let apify: ReturnType<typeof makeApify>;
  let gemini: ReturnType<typeof makeGemini>;
  let checklist: ReturnType<typeof makeChecklist>;
  let service: AutoReviewService;

  function build(enabled = true) {
    prisma = makePrisma();
    apify = makeApify();
    gemini = makeGemini();
    checklist = makeChecklist();
    service = new AutoReviewService(
      prisma as never,
      apify as never,
      gemini as never,
      checklist as never,
      makeConfig(enabled) as never,
    );
  }

  beforeEach(() => build());

  describe("runProofPipeline", () => {
    it("does nothing at all when AUTO_REVIEW_ENABLED is false — no lookups, no calls", async () => {
      build(false);
      prisma.formatDeliverable.findUnique.mockResolvedValue(baseDeliverable);

      await service.runProofPipeline("deliverable-1");

      expect(prisma.formatDeliverable.findUnique).not.toHaveBeenCalled();
      expect(prisma.autoReviewResult.create).not.toHaveBeenCalled();
    });

    it("does nothing when the deliverable has no live URL", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({ ...baseDeliverable, livePostUrl: null });

      await service.runProofPipeline("deliverable-1");

      expect(prisma.autoReviewResult.create).not.toHaveBeenCalled();
    });

    it("auto_rejects when the live link doesn't resolve", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(baseDeliverable);
      apify.checkPostResolves.mockResolvedValue({ status: "not_found" });

      await service.runProofPipeline("deliverable-1");

      expect(prisma.autoReviewResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deliverableId: "deliverable-1", stage: "proof", decision: "auto_rejected" }),
        }),
      );
    });

    it("needs_review when Tier 1 passes but there's no draft to run Tier 2 against", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(baseDeliverable);
      prisma.instagramConnection.findUnique.mockResolvedValue({
        platformHandle: "creator",
        platformUserId: "1",
      });
      apify.getPostAuthor.mockResolvedValue({ handle: "creator", platformUserId: "1" });

      await service.runProofPipeline("deliverable-1");

      const call = prisma.autoReviewResult.create.mock.calls[0][0];
      expect(call.data.decision).toBe("needs_review");
      expect(call.data.tier2Results).toBeUndefined();
    });
  });

  describe("runDraftPipeline", () => {
    it("does nothing at all when AUTO_REVIEW_ENABLED is false", async () => {
      build(false);
      await service.runDraftPipeline("deliverable-1");
      expect(prisma.formatDeliverable.findUnique).not.toHaveBeenCalled();
    });

    it("needs_review (not a failure) when the draft is Drive-linked and unfetchable", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        draftDriveUrl: "https://drive.google.com/file/d/abc/view",
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 404 }),
      );

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      const call = prisma.autoReviewResult.create.mock.calls[0][0];
      expect(call.data.stage).toBe("draft");
      expect(call.data.decision).toBe("needs_review");
    });

    it("does nothing when the deliverable has no draft at all", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({ ...baseDeliverable, draftDriveUrl: null });

      await service.runDraftPipeline("deliverable-1");

      expect(prisma.autoReviewResult.create).not.toHaveBeenCalled();
    });
  });

  it("never throws out of either pipeline, even if the deliverable lookup fails", async () => {
    prisma.formatDeliverable.findUnique.mockRejectedValue(new Error("db down"));

    await expect(service.runProofPipeline("deliverable-1")).resolves.toBeUndefined();
    await expect(service.runDraftPipeline("deliverable-1")).resolves.toBeUndefined();
  });
});
