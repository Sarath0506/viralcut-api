import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutoReviewService } from "./auto-review.service";
import * as videoCompress from "./video-compress";

// compressVideoForGemini shells out to a real ffmpeg process — not
// something a unit test should depend on. Tests that care about the
// source-video-match path mock its output explicitly; everything else
// just needs it to not hang, so this passthrough default is enough.
vi.spyOn(videoCompress, "compressVideoForGemini").mockImplementation(async (buffer) => buffer);

function makePrisma() {
  const prisma = {
    formatDeliverable: { findUnique: vi.fn(), update: vi.fn() },
    instagramConnection: { findUnique: vi.fn() },
    youtubeConnection: { findUnique: vi.fn() },
    autoReviewResult: { create: vi.fn() },
    deliverableRejectionEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  return prisma;
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

function makeRealtime() {
  return { emitDeliverableReviewed: vi.fn(), emitDeliverableLiveProof: vi.fn() };
}

function makeNotifications() {
  return { create: vi.fn().mockResolvedValue(undefined) };
}

function makeConfig(enabled: boolean, enforceEnabled = false) {
  return {
    get: vi.fn((key: string) => (key === "AUTO_REVIEW_ENFORCE_ENABLED" ? enforceEnabled : enabled)),
  };
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
  let realtime: ReturnType<typeof makeRealtime>;
  let notifications: ReturnType<typeof makeNotifications>;
  let service: AutoReviewService;

  function build(enabled = true, enforceEnabled = false) {
    prisma = makePrisma();
    apify = makeApify();
    gemini = makeGemini();
    checklist = makeChecklist();
    realtime = makeRealtime();
    notifications = makeNotifications();
    service = new AutoReviewService(
      prisma as never,
      apify as never,
      gemini as never,
      checklist as never,
      makeConfig(enabled, enforceEnabled) as never,
      realtime as never,
      notifications as never,
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

    it("fetches from adminUploadedDraftUrl instead of a Drive-linked draftDriveUrl when both are set", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post", // no strict aspect-ratio check — Tier 1 auto-passes
        draftDriveUrl: "https://drive.google.com/file/d/abc/view",
        adminUploadedDraftUrl: "https://pub-example.r2.dev/admin-draft-copies/real.mp4",
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");

      // Assert on the spy's recorded calls before mockRestore() — restoring
      // clears the call history, not just the mocked implementation.
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://pub-example.r2.dev/admin-draft-copies/real.mp4",
        expect.anything(),
      );
      expect(fetchSpy).not.toHaveBeenCalledWith(
        "https://drive.google.com/file/d/abc/view",
        expect.anything(),
      );
      fetchSpy.mockRestore();
      // Proves the fetched bytes actually made it to Tier 2, not just that
      // fetch was called with the right URL — the Drive-unfetchable branch
      // never reaches evaluateCompliance at all.
      expect(gemini.evaluateCompliance).toHaveBeenCalled();
      const call = prisma.autoReviewResult.create.mock.calls[0][0];
      expect(call.data.decision).not.toBe("needs_review");
    });

    it("does nothing when the deliverable has no draft at all", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({ ...baseDeliverable, draftDriveUrl: null });

      await service.runDraftPipeline("deliverable-1");

      expect(prisma.autoReviewResult.create).not.toHaveBeenCalled();
    });

    it("passes an uploaded campaign source asset through to evaluateCompliance as sourceMedia", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          campaign: {
            ...baseDeliverable.participation.campaign,
            sourceAssets: [
              { id: "s1", type: "drive", url: "https://drive.google.com/file/d/xyz/view", label: "" },
              { id: "s2", type: "upload", url: "https://pub-example.r2.dev/reference-assets/source.mp4", label: "" },
            ],
          },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");

      // Fetched the "upload" source asset, not the unfetchable Drive one.
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://pub-example.r2.dev/reference-assets/source.mp4",
        expect.anything(),
      );
      expect(fetchSpy).not.toHaveBeenCalledWith(
        "https://drive.google.com/file/d/xyz/view",
        expect.anything(),
      );
      fetchSpy.mockRestore();

      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMedia: { buffer: expect.any(Buffer), mimeType: "video/mp4" },
        }),
      );
    });

    it("fetches a Drive source asset via its direct-download URL when there's no uploaded one", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          campaign: {
            ...baseDeliverable.participation.campaign,
            sourceAssets: [{ id: "s1", type: "drive", url: "https://drive.google.com/file/d/xyz/view", label: "" }],
          },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");

      // The share-link URL itself is never fetched — it's resolved to
      // Drive's direct-download endpoint first.
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://drive.google.com/uc?export=download&id=xyz",
        expect.anything(),
      );
      fetchSpy.mockRestore();

      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMedia: { buffer: expect.any(Buffer), mimeType: "video/mp4" },
        }),
      );
    });

    it("passes sourceMedia: null when the Drive source asset fails to fetch, without falling back to YouTube", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          campaign: {
            ...baseDeliverable.participation.campaign,
            sourceAssets: [
              { id: "s1", type: "drive", url: "https://drive.google.com/file/d/xyz/view", label: "" },
              { id: "s2", type: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", label: "" },
            ],
          },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        if (typeof url === "string" && url.includes("uc?export=download")) {
          // Drive's virus-scan interstitial: an HTML page instead of the file.
          return new Response("<html>can't scan for viruses</html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } });
      });
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({ sourceMedia: null }),
      );
    });

    it("passes sourceMedia: null when the campaign has no source assets at all", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          campaign: { ...baseDeliverable.participation.campaign, sourceAssets: [] },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({ sourceMedia: null }),
      );
    });

    it("falls back to a YouTube source asset (sent as a direct reference, not fetched) when there's no uploaded or Drive one", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          campaign: {
            ...baseDeliverable.participation.campaign,
            sourceAssets: [
              { id: "s2", type: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", label: "" },
            ],
          },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");

      // Only the draft gets fetched — the YouTube source is never
      // downloaded, just referenced by URL.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        expect.anything(),
      );
      fetchSpy.mockRestore();

      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMedia: { youtubeUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
        }),
      );
    });

    it("passes sourceMedia: null — never calls Gemini with it — when a 'youtube' source asset's url isn't actually a URL", async () => {
      // Confirmed live: a campaign whose brief text got pasted into the
      // YouTube URL field by mistake sent that raw text to Gemini as
      // fileData.fileUri, which rejected the whole evaluateCompliance call
      // with a 400 — silently forcing needs_review on every submission to
      // that campaign, not just skipping the one source-video-match check.
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          campaign: {
            ...baseDeliverable.participation.campaign,
            sourceAssets: [
              { id: "s2", type: "youtube", url: "we want to make this song halchal in the instagram", label: "" },
            ],
          },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({ sourceMedia: null }),
      );
    });

    it("passes sourceMedia: null when a 'youtube' source asset's url is a real URL but not actually YouTube", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          campaign: {
            ...baseDeliverable.participation.campaign,
            sourceAssets: [
              { id: "s2", type: "youtube", url: "https://example.com/not-youtube", label: "" },
            ],
          },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({ sourceMedia: null }),
      );
    });

    it("prefers an uploaded source asset over a YouTube one when both exist", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          campaign: {
            ...baseDeliverable.participation.campaign,
            sourceAssets: [
              { id: "s1", type: "youtube", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", label: "" },
              { id: "s2", type: "upload", url: "https://pub-example.r2.dev/reference-assets/source.mp4", label: "" },
            ],
          },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMedia: { buffer: expect.any(Buffer), mimeType: "video/mp4" },
        }),
      );
    });
  });

  describe("sourceVideoRequirement / sourceAudioRequirement toggles", () => {
    const sourceAssetFixture = (overrides: Record<string, unknown>) => ({
      ...baseDeliverable,
      platform: "instagram_post",
      draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
      participation: {
        ...baseDeliverable.participation,
        campaign: {
          ...baseDeliverable.participation.campaign,
          sourceAssets: [
            { id: "s1", type: "upload", url: "https://pub-example.r2.dev/reference-assets/source.mp4", label: "" },
          ],
          ...overrides,
        },
      },
    });

    it("a failing 'optional' video-match check never gates the decision", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(
        sourceAssetFixture({ sourceVideoRequirement: "optional" }),
      );
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
        {
          criterionId: "source_video_match",
          label: "visual match",
          pass: false,
          confidence: 0.95,
          reason: "different footage",
          required: false,
        },
      ]);

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      const call = prisma.autoReviewResult.create.mock.calls[0][0];
      expect(call.data.decision).toBe("auto_approved");
    });

    it("a failing 'mandatory' audio-match check does gate the decision, for a song campaign with no video requirement", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(
        sourceAssetFixture({ sourceVideoRequirement: "not_required", sourceAudioRequirement: "mandatory" }),
      );
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
        {
          criterionId: "source_audio_match",
          label: "audio match",
          pass: false,
          confidence: 0.95,
          reason: "different song",
          required: true,
        },
      ]);

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      // The checklist sent to Gemini should ask about audio, not video —
      // any footage is fine for a song-push campaign.
      const checklistSent = gemini.evaluateCompliance.mock.calls[0][0].checklist as Array<{ id: string }>;
      expect(checklistSent.some((c) => c.id === "source_audio_match")).toBe(true);
      expect(checklistSent.some((c) => c.id === "source_video_match")).toBe(false);

      const call = prisma.autoReviewResult.create.mock.calls[0][0];
      expect(call.data.decision).toBe("auto_rejected");
    });

    it("never fetches the source asset at all when both requirements are not_required", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue(
        sourceAssetFixture({ sourceVideoRequirement: "not_required", sourceAudioRequirement: "not_required" }),
      );
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
      );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.9, reason: "ok", required: true },
      ]);

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      // Only the draft itself gets fetched — the source asset URL never does.
      expect(fetchSpy).not.toHaveBeenCalledWith(
        "https://pub-example.r2.dev/reference-assets/source.mp4",
        expect.anything(),
      );
      expect(gemini.evaluateCompliance).toHaveBeenCalledWith(
        expect.objectContaining({ sourceMedia: null }),
      );
    });
  });

  describe("Campaign.autoReviewEnabled", () => {
    it("skips the draft pipeline entirely — never touches checklist/Gemini — when the campaign has it disabled", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/draft.mp4",
        participation: {
          ...baseDeliverable.participation,
          campaign: { ...baseDeliverable.participation.campaign, autoReviewEnabled: false },
        },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await service.runDraftPipeline("deliverable-1");

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(checklist.getOrCreateChecklist).not.toHaveBeenCalled();
      expect(gemini.evaluateCompliance).not.toHaveBeenCalled();
      expect(prisma.autoReviewResult.create).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("skips the proof pipeline entirely when the campaign has it disabled", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        participation: {
          ...baseDeliverable.participation,
          campaign: { ...baseDeliverable.participation.campaign, autoReviewEnabled: false },
        },
      });

      await service.runProofPipeline("deliverable-1");

      expect(apify.checkPostResolves).not.toHaveBeenCalled();
      expect(prisma.autoReviewResult.create).not.toHaveBeenCalled();
    });

    it("still runs normally when autoReviewEnabled is true", async () => {
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...baseDeliverable,
        participation: {
          ...baseDeliverable.participation,
          campaign: { ...baseDeliverable.participation.campaign, autoReviewEnabled: true },
        },
      });

      await service.runProofPipeline("deliverable-1");

      expect(apify.checkPostResolves).toHaveBeenCalled();
    });
  });

  it("never throws out of either pipeline, even if the deliverable lookup fails", async () => {
    prisma.formatDeliverable.findUnique.mockRejectedValue(new Error("db down"));

    await expect(service.runProofPipeline("deliverable-1")).resolves.toBeUndefined();
    await expect(service.runDraftPipeline("deliverable-1")).resolves.toBeUndefined();
  });

  describe("enforcement (AUTO_REVIEW_ENFORCE_ENABLED)", () => {
    const enforceFixture = {
      id: "deliverable-1",
      platform: "instagram_reel",
      livePostUrl: "https://www.instagram.com/reel/abc123/",
      draftDriveUrl: null as string | null,
      status: "under_review",
      participation: {
        id: "participation-1",
        creatorId: "creator-1",
        creatorProfileId: "profile-1",
        campaignId: "campaign-1",
        campaign: {
          id: "campaign-1",
          title: "Test Campaign",
          brief: "brief",
          doRules: null,
          avoidRules: null,
          brandProfileId: "brand-1",
        },
      },
    };

    it("stays shadow-mode by default — an auto_rejected decision never touches real status", async () => {
      build(true, false);
      prisma.formatDeliverable.findUnique.mockResolvedValue(enforceFixture);
      apify.checkPostResolves.mockResolvedValue({ status: "not_found" });

      await service.runProofPipeline("deliverable-1");

      expect(prisma.formatDeliverable.update).not.toHaveBeenCalled();
      expect(realtime.emitDeliverableLiveProof).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it("applies a real auto_rejected proof decision when enforcement is on", async () => {
      build(true, true);
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...enforceFixture,
        status: "proof_under_review",
      });
      prisma.formatDeliverable.update.mockResolvedValue({
        ...enforceFixture,
        status: "proof_rejected",
      });
      apify.checkPostResolves.mockResolvedValue({ status: "not_found" });

      await service.runProofPipeline("deliverable-1");

      expect(prisma.formatDeliverable.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "deliverable-1" },
          data: expect.objectContaining({ status: "proof_rejected" }),
        }),
      );
      expect(realtime.emitDeliverableLiveProof).toHaveBeenCalledWith(
        expect.objectContaining({ deliverableId: "deliverable-1", status: "proof_rejected" }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        "creator-1",
        "creator",
        expect.objectContaining({ type: "proof_rejected" }),
      );
    });

    it("applies a real auto_approved proof decision when enforcement is on, without touching payout fields", async () => {
      build(true, true);
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...enforceFixture,
        status: "proof_under_review",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/x.mp4",
      });
      prisma.instagramConnection.findUnique.mockResolvedValue({
        platformHandle: "creator",
        platformUserId: "1",
      });
      apify.getPostAuthor.mockResolvedValue({ handle: "creator", platformUserId: "1" });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(
          async () =>
            new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
        );
      apify.getLivePostMedia.mockResolvedValue({ kind: "video", url: "https://example.com/live.mp4" });
      gemini.compareDraftToLive.mockResolvedValue({ same: true, confidence: 0.95, reason: "matches" });
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: true, confidence: 0.95, reason: "ok", required: true },
      ]);
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      prisma.formatDeliverable.update.mockResolvedValue({
        ...enforceFixture,
        status: "proof_approved",
      });

      await service.runProofPipeline("deliverable-1");
      fetchSpy.mockRestore();

      const updateCall = prisma.formatDeliverable.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe("proof_approved");
      expect(updateCall.data).not.toHaveProperty("paidAmountPaise");
      expect(notifications.create).toHaveBeenCalledWith(
        "creator-1",
        "creator",
        expect.objectContaining({ type: "proof_approved" }),
      );
    });

    it("applies a real auto_rejected draft decision when enforcement is on, recording a rejection event", async () => {
      build(true, true);
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...enforceFixture,
        // instagram_post has no strict aspect-ratio requirement, so Tier 1's
        // format gate always passes without ever shelling out to ffprobe —
        // keeps this test deterministic and lets Tier 2 alone drive the
        // auto_rejected decision.
        platform: "instagram_post",
        draftDriveUrl: "https://pub-example.r2.dev/creator-drafts/x.mp4",
      });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(
          async () =>
            new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "video/mp4" } }),
        );
      checklist.getOrCreateChecklist.mockResolvedValue([{ id: "c1", label: "x", source: "brief" }]);
      gemini.evaluateCompliance.mockResolvedValue([
        { criterionId: "c1", label: "x", pass: false, confidence: 0.95, reason: "off-brief content", required: true },
      ]);
      prisma.formatDeliverable.update.mockResolvedValue({
        ...enforceFixture,
        status: "draft_rejected",
      });

      await service.runDraftPipeline("deliverable-1");
      fetchSpy.mockRestore();

      expect(prisma.deliverableRejectionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deliverableId: "deliverable-1" }),
        }),
      );
      expect(prisma.formatDeliverable.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "draft_rejected" }) }),
      );
    });

    it("never enforces a needs_review decision, regardless of the flag", async () => {
      build(true, true);
      prisma.formatDeliverable.findUnique.mockResolvedValue({
        ...enforceFixture,
        draftDriveUrl: null,
      });

      await service.runDraftPipeline("deliverable-1");

      expect(prisma.formatDeliverable.update).not.toHaveBeenCalled();
    });

    it("skips applying the decision if a human already reviewed it while the pipeline was running", async () => {
      build(true, true);
      prisma.formatDeliverable.findUnique
        .mockResolvedValueOnce(enforceFixture) // evaluate() fetch
        .mockResolvedValueOnce({ ...enforceFixture, status: "draft_approved" }); // apply() re-fetch
      apify.checkPostResolves.mockResolvedValue({ status: "not_found" });

      await service.runProofPipeline("deliverable-1");

      expect(prisma.formatDeliverable.update).not.toHaveBeenCalled();
    });
  });
});
