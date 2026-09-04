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
  };
}

const baseDeliverable = {
  id: "deliverable-1",
  platform: "instagram_reel",
  livePostUrl: "https://www.instagram.com/reel/abc123/",
  participation: { creatorProfileId: "profile-1" },
};

describe("AutoReviewService.runPipeline", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let apify: ReturnType<typeof makeApify>;
  let service: AutoReviewService;

  beforeEach(() => {
    prisma = makePrisma();
    apify = makeApify();
    service = new AutoReviewService(prisma as never, apify as never);
  });

  it("does nothing when the deliverable has no live URL", async () => {
    prisma.formatDeliverable.findUnique.mockResolvedValue({ ...baseDeliverable, livePostUrl: null });

    await service.runPipeline("deliverable-1");

    expect(prisma.autoReviewResult.create).not.toHaveBeenCalled();
  });

  it("auto_rejects when the live link doesn't resolve", async () => {
    prisma.formatDeliverable.findUnique.mockResolvedValue(baseDeliverable);
    apify.checkPostResolves.mockResolvedValue({ status: "not_found" });
    prisma.instagramConnection.findUnique.mockResolvedValue(null);

    await service.runPipeline("deliverable-1");

    expect(prisma.autoReviewResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliverableId: "deliverable-1", decision: "auto_rejected" }),
      }),
    );
  });

  it("auto_rejects when the live URL's platform doesn't match the campaign format", async () => {
    prisma.formatDeliverable.findUnique.mockResolvedValue({
      ...baseDeliverable,
      platform: "youtube_shorts",
    });
    apify.detectPlatform.mockReturnValue("instagram");
    prisma.instagramConnection.findUnique.mockResolvedValue(null);

    await service.runPipeline("deliverable-1");

    expect(prisma.autoReviewResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decision: "auto_rejected" }),
      }),
    );
  });

  it("needs_review when everything resolvable passes but ownership is unresolved (no OAuth connection)", async () => {
    prisma.formatDeliverable.findUnique.mockResolvedValue(baseDeliverable);
    prisma.instagramConnection.findUnique.mockResolvedValue(null);

    await service.runPipeline("deliverable-1");

    expect(prisma.autoReviewResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decision: "needs_review" }),
      }),
    );
  });

  it("still needs_review even when ownership passes, since Tier 2 hasn't run yet (draft-live gate stub is always unresolved)", async () => {
    prisma.formatDeliverable.findUnique.mockResolvedValue(baseDeliverable);
    prisma.instagramConnection.findUnique.mockResolvedValue({
      platformHandle: "creator",
      platformUserId: "1",
    });
    apify.getPostAuthor.mockResolvedValue({ handle: "creator", platformUserId: "1" });

    await service.runPipeline("deliverable-1");

    const call = prisma.autoReviewResult.create.mock.calls[0][0];
    expect(call.data.decision).toBe("needs_review");
    expect(call.data.tier2Results).toBeUndefined();
  });

  it("never throws out of runPipeline, even if the deliverable lookup itself fails", async () => {
    prisma.formatDeliverable.findUnique.mockRejectedValue(new Error("db down"));

    await expect(service.runPipeline("deliverable-1")).resolves.toBeUndefined();
  });
});
