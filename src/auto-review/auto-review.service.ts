import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FormatDeliverableStatus, SourceAssetRequirement } from "@prisma/client";

import { ApifyService } from "../common/apify.service";
import type { Env } from "../config/env";
import { InAppNotificationService } from "../notifications/in-app-notification.service";
import { PrismaService } from "../prisma/prisma.service";
import type { DeliverableEventPayload } from "../realtime/realtime.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { AutoReviewOutcome, CriterionResult, GateResult } from "./auto-review.types";
import { ChecklistService } from "./checklist.service";
import { checkFormatGate } from "./format-gate";
import { GeminiService } from "./gemini.service";
import { fetchMedia } from "./media-fetch";
import { compressVideoForGemini } from "./video-compress";
import {
  evaluateDraftLiveMatchGate,
  evaluateOwnershipGate,
  evaluatePlatformMatchGate,
  evaluateResolvesGate,
} from "./tier1-gates";

const GEMINI_MODEL_VERSION = "gemini-2.5-flash";
const HIGH_CONFIDENCE_FAIL_THRESHOLD = 0.8;
const LOW_CONFIDENCE_THRESHOLD = 0.7;

const PLATFORM_LABELS: Record<string, string> = {
  instagram_reel: "Instagram Reel",
  instagram_reels: "Instagram Reel",
  instagram_post: "Instagram Post",
  youtube_shorts: "YouTube Shorts",
  twitter_tweet: "Twitter / X",
};

function formatPlatform(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.replace(/_/g, " ");
}

/** A "youtube" source asset's URL is handed to Gemini directly as
 * fileData.fileUri with no fetch of our own first (see
 * fetchSourceAssetMedia) — so unlike the upload/drive branches, nothing
 * else catches a genuinely malformed value before it reaches the Gemini
 * API call. Deliberately narrow (http(s) + a real youtube.com/youtu.be
 * host) rather than just "is this a URL at all", since anything looser
 * would still accept a non-YouTube link that Gemini's fileUri support
 * doesn't handle either. */
function isPlausibleYoutubeUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^www\./, "");
  return host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com";
}

/** Turns the pipeline's structured gate/criterion results into a full,
 * human-readable rejection reason — used only when AUTO_REVIEW_ENFORCE_ENABLED
 * actually applies an auto_rejected decision for real. Lists every gate and
 * every checklist item that was actually evaluated, not just the one that
 * tipped the decision — a creator seeing an automated rejection should be
 * able to see everything that was checked, including what passed, not just
 * a single cherry-picked line. */
function buildAutoRejectionReason(
  tier1Results: GateResult[],
  tier2Results: CriterionResult[] | null,
): string {
  const lines: string[] = [];
  for (const gate of tier1Results) {
    if (gate.status === "fail") lines.push(`✗ ${gate.reason}`);
  }

  let failedCount = tier1Results.filter((g) => g.status === "fail").length;
  if (tier2Results) {
    failedCount += tier2Results.filter((c) => c.required && !c.pass).length;
    for (const c of tier2Results) {
      const suffix = c.required ? "" : " (optional — not counted toward this decision)";
      lines.push(c.pass ? `✓ ${c.label}${suffix}` : `✗ ${c.label}: ${c.reason}${suffix}`);
    }
  }

  if (lines.length === 0) return "Automated review flagged this submission for changes.";
  const totalChecks =
    tier1Results.length + (tier2Results?.filter((c) => c.required).length ?? 0);
  const header =
    totalChecks > 1
      ? `Automated review — ${failedCount} of ${totalChecks} checks failed:`
      : "Automated review:";
  return [header, ...lines].join("\n");
}

/** Automated pre-screening for both the draft/work-upload stage and the
 * live-proof stage, alongside the existing human review flows for each.
 * Always logs a decision to AutoReviewResult. When AUTO_REVIEW_ENFORCE_ENABLED
 * is also on, an auto_approved/auto_rejected decision is additionally
 * *applied* for real — same status transition, realtime event, and
 * notification a human reviewer's action would produce. needs_review is
 * never enforced; a human always reviews those. Never sets paidAmountPaise,
 * never calls anything in payouts.service.ts — approving a live-proof still
 * requires a separate, human-triggered payout action. Gated end-to-end
 * behind AUTO_REVIEW_ENABLED — with that off (the default), nothing here
 * runs and no external API is ever called. Also gated per-campaign via
 * Campaign.autoReviewEnabled (default true) — a brand/admin can turn
 * automation off for one specific campaign without touching the global
 * flag, which still governs every other campaign. See the plan doc for the
 * full design and the gaps this deliberately doesn't attempt to solve. */
@Injectable()
export class AutoReviewService {
  private readonly logger = new Logger(AutoReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apify: ApifyService,
    private readonly gemini: GeminiService,
    private readonly checklist: ChecklistService,
    private readonly config: ConfigService<Env, true>,
    private readonly realtime: RealtimeService,
    private readonly notifications: InAppNotificationService,
  ) {}

  private get enabled(): boolean {
    return this.config.get("AUTO_REVIEW_ENABLED", { infer: true });
  }

  private get enforceEnabled(): boolean {
    return this.config.get("AUTO_REVIEW_ENFORCE_ENABLED", { infer: true });
  }

  /** Entry point from submitLiveProof — fire-and-forget, never awaited. */
  async runProofPipeline(deliverableId: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const outcome = await this.evaluateProof(deliverableId);
      if (!outcome) return;
      await this.persist(deliverableId, "proof", outcome);
      if (this.enforceEnabled) {
        await this.applyProofDecision(deliverableId, outcome);
      }
    } catch (err) {
      this.logger.error(`Proof auto-review failed for deliverable ${deliverableId}: ${err}`);
    }
  }

  /** Entry point from submitDraft — fire-and-forget, never awaited. */
  async runDraftPipeline(deliverableId: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const outcome = await this.evaluateDraft(deliverableId);
      if (!outcome) return;
      await this.persist(deliverableId, "draft", outcome);
      if (this.enforceEnabled) {
        await this.applyDraftDecision(deliverableId, outcome);
      }
    } catch (err) {
      this.logger.error(`Draft auto-review failed for deliverable ${deliverableId}: ${err}`);
    }
  }

  private async persist(
    deliverableId: string,
    stage: "draft" | "proof",
    outcome: AutoReviewOutcome,
  ): Promise<void> {
    await this.prisma.autoReviewResult.create({
      data: {
        deliverableId,
        stage,
        decision: outcome.decision,
        tier1Results: outcome.tier1Results,
        tier2Results: outcome.tier2Results ?? undefined,
        modelVersion: outcome.modelVersion,
      },
    });
  }

  /** Applies an auto_approved/auto_rejected draft decision for real — only
   * called when AUTO_REVIEW_ENFORCE_ENABLED is on. Re-fetches the current
   * status first: if a human already reviewed it while the pipeline was
   * running, their decision stands and this is a no-op. */
  private async applyDraftDecision(deliverableId: string, outcome: AutoReviewOutcome): Promise<void> {
    if (outcome.decision !== "auto_approved" && outcome.decision !== "auto_rejected") return;

    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: {
        participation: {
          select: {
            id: true,
            creatorId: true,
            campaignId: true,
            campaign: { select: { title: true, brandProfileId: true } },
          },
        },
      },
    });
    if (!deliverable) return;
    if (deliverable.status !== FormatDeliverableStatus.under_review) {
      this.logger.log(
        `Skipping draft auto-enforce for ${deliverableId} — status is now ${deliverable.status}, a human already acted`,
      );
      return;
    }

    const eventBase: Omit<DeliverableEventPayload, "status"> = {
      deliverableId: deliverable.id,
      participationId: deliverable.participation.id,
      campaignId: deliverable.participation.campaignId,
      creatorId: deliverable.participation.creatorId,
      brandProfileId: deliverable.participation.campaign.brandProfileId,
      platform: deliverable.platform,
    };

    if (outcome.decision === "auto_approved") {
      const updated = await this.prisma.formatDeliverable.update({
        where: { id: deliverableId },
        data: {
          status: FormatDeliverableStatus.draft_approved,
          draftReviewedAt: new Date(),
          rejectionReason: null,
        },
      });
      this.realtime.emitDeliverableReviewed({ ...eventBase, status: updated.status });
      await this.notifications.create(deliverable.participation.creatorId, "creator", {
        type: "draft_approved",
        title: "Draft approved 🎉",
        body: `Your ${formatPlatform(updated.platform)} draft for ${deliverable.participation.campaign.title} was approved. Post it live and submit the link to get paid.`,
        link: `/participations/${deliverable.participation.id}`,
      });
      this.logger.log(`Auto-approved draft for deliverable ${deliverableId}`);
      return;
    }

    const reason = buildAutoRejectionReason(outcome.tier1Results, outcome.tier2Results);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.deliverableRejectionEvent.create({
        data: {
          deliverableId,
          draftDriveUrl: deliverable.draftDriveUrl?.trim() ?? "",
          rejectionReason: reason,
        },
      });
      return tx.formatDeliverable.update({
        where: { id: deliverableId },
        data: {
          status: FormatDeliverableStatus.draft_rejected,
          rejectionReason: reason,
          draftReviewedAt: new Date(),
        },
      });
    });
    this.realtime.emitDeliverableReviewed({ ...eventBase, status: updated.status });
    await this.notifications.create(deliverable.participation.creatorId, "creator", {
      type: "draft_rejected",
      title: "Draft needs changes",
      body: `Your ${formatPlatform(updated.platform)} draft for ${deliverable.participation.campaign.title} needs changes: ${reason}`,
      link: `/participations/${deliverable.participation.id}`,
    });
    this.logger.log(`Auto-rejected draft for deliverable ${deliverableId}: ${reason}`);
  }

  /** Applies an auto_approved/auto_rejected proof decision for real — only
   * called when AUTO_REVIEW_ENFORCE_ENABLED is on. Approving still never
   * sets paidAmountPaise or calls anything payout-related; that stays a
   * separate, human-triggered action. Re-fetches the current status first:
   * if a human already reviewed it while the pipeline was running, their
   * decision stands and this is a no-op. */
  private async applyProofDecision(deliverableId: string, outcome: AutoReviewOutcome): Promise<void> {
    if (outcome.decision !== "auto_approved" && outcome.decision !== "auto_rejected") return;

    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: {
        participation: {
          select: {
            id: true,
            creatorId: true,
            campaignId: true,
            campaign: { select: { title: true, brandProfileId: true } },
          },
        },
      },
    });
    if (!deliverable) return;

    const reviewable: FormatDeliverableStatus[] = [
      FormatDeliverableStatus.proof_under_review,
      FormatDeliverableStatus.live_submitted,
    ];
    if (!reviewable.includes(deliverable.status)) {
      this.logger.log(
        `Skipping proof auto-enforce for ${deliverableId} — status is now ${deliverable.status}, a human already acted`,
      );
      return;
    }

    const eventBase: Omit<DeliverableEventPayload, "status"> = {
      deliverableId: deliverable.id,
      participationId: deliverable.participation.id,
      campaignId: deliverable.participation.campaignId,
      creatorId: deliverable.participation.creatorId,
      brandProfileId: deliverable.participation.campaign.brandProfileId,
      platform: deliverable.platform,
    };

    if (outcome.decision === "auto_approved") {
      const updated = await this.prisma.formatDeliverable.update({
        where: { id: deliverableId },
        data: {
          status: FormatDeliverableStatus.proof_approved,
          proofReviewedAt: new Date(),
        },
      });
      this.realtime.emitDeliverableLiveProof({ ...eventBase, status: updated.status });
      await this.notifications.create(deliverable.participation.creatorId, "creator", {
        type: "proof_approved",
        title: "Proof approved — payout on the way",
        body: `Your live ${formatPlatform(updated.platform)} post for ${deliverable.participation.campaign.title} was verified. Payout will be processed shortly.`,
        link: `/participations/${deliverable.participation.id}`,
      });
      this.logger.log(`Auto-approved proof for deliverable ${deliverableId}`);
      return;
    }

    const reason = buildAutoRejectionReason(outcome.tier1Results, outcome.tier2Results);
    const updated = await this.prisma.formatDeliverable.update({
      where: { id: deliverableId },
      data: {
        status: FormatDeliverableStatus.proof_rejected,
        rejectionReason: reason,
        proofReviewedAt: new Date(),
      },
    });
    this.realtime.emitDeliverableLiveProof({ ...eventBase, status: updated.status });
    await this.notifications.create(deliverable.participation.creatorId, "creator", {
      type: "proof_rejected",
      title: "Proof rejected",
      body: `Your live ${formatPlatform(updated.platform)} post for ${deliverable.participation.campaign.title} was rejected: ${reason}`,
      link: `/participations/${deliverable.participation.id}`,
    });
    this.logger.log(`Auto-rejected proof for deliverable ${deliverableId}: ${reason}`);
  }

  private async evaluateProof(deliverableId: string): Promise<AutoReviewOutcome | null> {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: {
        participation: {
          select: {
            creatorProfileId: true,
            campaign: {
              select: {
                id: true,
                brief: true,
                doRules: true,
                avoidRules: true,
                sourceAssets: true,
                sourceVideoRequirement: true,
                sourceAudioRequirement: true,
                autoReviewEnabled: true,
              },
            },
          },
        },
      },
    });
    if (!deliverable || !deliverable.livePostUrl) {
      this.logger.warn(`Proof auto-review skipped — deliverable ${deliverableId} not found or has no live URL`);
      return null;
    }
    if (deliverable.participation.campaign.autoReviewEnabled === false) {
      this.logger.log(`Proof auto-review skipped — disabled for campaign ${deliverable.participation.campaign.id}`);
      return null;
    }

    const livePostUrl = deliverable.livePostUrl;
    const creatorProfileId = deliverable.participation.creatorProfileId;
    const platform = this.apify.detectPlatform(livePostUrl);
    // Prefer a brand/admin-uploaded copy of the source video — set when
    // draftDriveUrl is a Drive link the pipeline can't fetch itself.
    const fetchableDraftUrl = deliverable.adminUploadedDraftUrl ?? deliverable.draftDriveUrl;

    const [resolution, author, connection, draftMedia] = await Promise.all([
      this.apify.checkPostResolves(livePostUrl),
      this.apify.getPostAuthor(livePostUrl),
      this.getConnection(creatorProfileId, platform),
      fetchableDraftUrl ? fetchMedia(fetchableDraftUrl) : Promise.resolve(null),
    ]);

    let liveComparison: { same: boolean; confidence: number; reason: string } | null = null;
    if (draftMedia) {
      const liveMedia = await this.apify.getLivePostMedia(livePostUrl);
      if (liveMedia) {
        const liveMediaFetched = await fetchMedia(liveMedia.url);
        if (liveMediaFetched) {
          liveComparison = await this.gemini.compareDraftToLive({
            draftMediaBuffer: draftMedia.buffer,
            draftMimeType: draftMedia.mimeType,
            liveMediaBuffer: liveMediaFetched.buffer,
            liveMediaKind: liveMedia.kind,
          });
        }
      }
    }

    const tier1Results: GateResult[] = [
      evaluateResolvesGate(resolution),
      evaluatePlatformMatchGate(platform, deliverable.platform),
      evaluateOwnershipGate(connection, author),
      evaluateDraftLiveMatchGate(liveComparison),
    ];

    const tier2Results = draftMedia
      ? await this.runCompliance(
          deliverable.participation.campaign,
          draftMedia.buffer,
          draftMedia.mimeType,
          null,
        )
      : null;

    return {
      decision: this.decide(tier1Results, tier2Results),
      tier1Results,
      tier2Results,
      modelVersion: tier2Results || liveComparison ? GEMINI_MODEL_VERSION : null,
    };
  }

  private async evaluateDraft(deliverableId: string): Promise<AutoReviewOutcome | null> {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: {
        participation: {
          select: {
            campaign: {
              select: {
                id: true,
                brief: true,
                doRules: true,
                avoidRules: true,
                sourceAssets: true,
                sourceVideoRequirement: true,
                sourceAudioRequirement: true,
                autoReviewEnabled: true,
              },
            },
          },
        },
      },
    });
    if (!deliverable || !deliverable.draftDriveUrl) {
      this.logger.warn(`Draft auto-review skipped — deliverable ${deliverableId} not found or has no draft`);
      return null;
    }
    if (deliverable.participation.campaign.autoReviewEnabled === false) {
      this.logger.log(`Draft auto-review skipped — disabled for campaign ${deliverable.participation.campaign.id}`);
      return null;
    }

    // Prefer a brand/admin-uploaded copy of the source video — set when
    // draftDriveUrl is a Drive link the pipeline can't fetch itself.
    const fetchableDraftUrl = deliverable.adminUploadedDraftUrl ?? deliverable.draftDriveUrl;
    const draftMedia = await fetchMedia(fetchableDraftUrl);
    if (!draftMedia) {
      // Drive-linked drafts aren't server-fetchable without an admin-uploaded
      // copy — see the plan doc. Not a failure, just nothing this pipeline
      // can check yet.
      const tier1Results: GateResult[] = [
        {
          gate: "format_match",
          status: "unresolved",
          reason: deliverable.adminUploadedDraftUrl
            ? "Could not fetch the admin-uploaded source video"
            : "Draft is not an app-uploaded file (likely a Drive link) — can't fetch it to check",
        },
      ];
      return { decision: "needs_review", tier1Results, tier2Results: null, modelVersion: null };
    }

    const formatResult = await checkFormatGate(draftMedia.buffer, deliverable.platform);
    const tier1Results: GateResult[] = [formatResult];

    const tier2Results = await this.runCompliance(
      deliverable.participation.campaign,
      draftMedia.buffer,
      draftMedia.mimeType,
      null,
    );

    return {
      decision: this.decide(tier1Results, tier2Results),
      tier1Results,
      tier2Results,
      modelVersion: tier2Results ? GEMINI_MODEL_VERSION : null,
    };
  }

  /** Builds the full checklist for one evaluation — the campaign's
   * brief-derived items, plus up to two synthetic source-match items
   * (source_video_match/source_audio_match), added only for whichever of
   * the campaign's two independent requirement toggles isn't
   * "not_required". A campaign pushing a song viral (any footage OK, but
   * must use this audio) sets sourceVideoRequirement to not_required and
   * sourceAudioRequirement to mandatory; a campaign requiring the clip be
   * edited from specific footage keeps the default (video mandatory, audio
   * not required). "optional" still runs the check and shows it to a
   * reviewer, but never gates the decision — see decide(). */
  private async runCompliance(
    campaign: {
      id: string;
      brief: string;
      doRules: string | null;
      avoidRules: string | null;
      sourceAssets?: unknown;
      sourceVideoRequirement?: SourceAssetRequirement;
      sourceAudioRequirement?: SourceAssetRequirement;
    },
    videoBuffer: Buffer,
    mimeType: string,
    caption: string | null,
  ): Promise<CriterionResult[] | null> {
    const checklist = await this.checklist.getOrCreateChecklist(campaign.id);
    if (!checklist) return null;

    const videoRequirement = campaign.sourceVideoRequirement ?? SourceAssetRequirement.mandatory;
    const audioRequirement = campaign.sourceAudioRequirement ?? SourceAssetRequirement.not_required;
    const needsSourceMedia =
      videoRequirement !== SourceAssetRequirement.not_required ||
      audioRequirement !== SourceAssetRequirement.not_required;
    const sourceMedia = needsSourceMedia
      ? await this.fetchSourceAssetMedia(campaign.sourceAssets)
      : null;

    const fullChecklist = [...checklist];
    if (sourceMedia) {
      if (videoRequirement !== SourceAssetRequirement.not_required) {
        fullChecklist.push({
          id: "source_video_match",
          label: "The clip is predominantly edited from the provided source footage, not substantially unrelated visuals",
          source: "sourceVideo",
          required: videoRequirement === SourceAssetRequirement.mandatory,
        });
      }
      if (audioRequirement !== SourceAssetRequirement.not_required) {
        fullChecklist.push({
          id: "source_audio_match",
          label: "The clip's audio track uses the provided source audio (e.g. the same song)",
          source: "sourceAudio",
          required: audioRequirement === SourceAssetRequirement.mandatory,
        });
      }
    }

    return this.gemini.evaluateCompliance({ videoBuffer, mimeType, caption, checklist: fullChecklist, sourceMedia });
  }

  /** Fetches the campaign's source asset so runCompliance can check the
   * submission's visual and/or audio match against it — which of those two
   * actually gets asked about, and whether a fail on either can gate the
   * decision, is decided by the campaign's sourceVideoRequirement/
   * sourceAudioRequirement toggles in runCompliance, not here. Prefers an
   * "upload" (device-uploaded via the portal) source asset when one exists,
   * then a "drive" one (resolved to Drive's direct-download URL by
   * fetchMedia — works unless it trips Drive's virus-scan interstitial),
   * then falls back to a "youtube" one sent to Gemini as a direct
   * fileData.fileUri reference rather than bytes we fetch ourselves (Gemini
   * fetches and processes the video server-side — verified live against a
   * real public video). Picks the first fetchable one; a campaign with
   * several source assets only gets checked against one.
   *
   * Uploaded videos are downscaled before being handed to Gemini — a raw
   * 4K phone recording sent inline at full size made a single
   * evaluateCompliance call take minutes (confirmed live, never actually
   * completed in one real test). Gemini only needs enough resolution to
   * judge whether the clip visually derives from this footage. */
  private async fetchSourceAssetMedia(
    sourceAssets: unknown,
  ): Promise<{ buffer: Buffer; mimeType: string } | { youtubeUrl: string } | null> {
    if (!Array.isArray(sourceAssets)) return null;
    const findByType = (type: string) =>
      sourceAssets.find(
        (a): a is { type: string; url: string } =>
          !!a && typeof a === "object" && (a as { type?: unknown }).type === type &&
          typeof (a as { url?: unknown }).url === "string",
      );

    const fetchAndCompress = async (url: string) => {
      const media = await fetchMedia(url);
      if (!media) return null;
      // Images and pure-audio files (a brand uploading just the song, no
      // video) pass through as-is — ffmpeg's scale filter used below has no
      // video stream to work with on an audio-only file and would fail.
      if (media.mimeType.startsWith("image/") || media.mimeType.startsWith("audio/")) return media;

      const compressed = await compressVideoForGemini(media.buffer);
      if (!compressed) {
        this.logger.warn(`Could not compress source asset video at ${url} — skipping source-video-match check`);
        return null;
      }
      return { buffer: compressed, mimeType: "video/mp4" };
    };

    const uploaded = findByType("upload");
    if (uploaded) return fetchAndCompress(uploaded.url);

    // A Drive share link isn't a webpage Gemini can fetch itself (unlike
    // YouTube, below) but fetchMedia transparently resolves it to Drive's
    // direct-download endpoint first — works for files that don't trip
    // Drive's virus-scan interstitial, confirmed live against a real Drive
    // link. Falls through to null (not the youtube branch) on failure,
    // same as the upload case — no cascading fallback across source asset
    // types.
    const drive = findByType("drive");
    if (drive) return fetchAndCompress(drive.url);

    // Validated before use, unlike upload/drive above — those two go
    // through fetchMedia, which already fails closed (returns null) on a
    // malformed URL via its own try/catch. This one is handed straight to
    // Gemini as fileData.fileUri with no fetch of our own first, so an
    // un-validated garbage value (confirmed live: a campaign's brief text
    // pasted into the URL field by mistake) reaches the Gemini API call
    // directly — which doesn't fail closed the way this pipeline expects.
    // A single malformed source asset then breaks EVERY checklist item in
    // evaluateCompliance, not just the source-video-match one, since
    // evaluateCompliance throws before it can score anything — silently
    // forcing needs_review for every submission to that campaign, not a
    // targeted failure of just the one check that's actually unresolvable.
    const youtube = findByType("youtube");
    if (youtube && isPlausibleYoutubeUrl(youtube.url)) return { youtubeUrl: youtube.url };
    if (youtube) {
      this.logger.warn(`Source asset marked "youtube" isn't a usable URL, skipping: ${youtube.url}`);
    }

    return null;
  }

  private decide(
    tier1Results: GateResult[],
    tier2Results: CriterionResult[] | null,
  ): AutoReviewOutcome["decision"] {
    if (tier1Results.some((r) => r.status === "fail")) return "auto_rejected";
    if (tier1Results.some((r) => r.status === "unresolved")) return "needs_review";

    // Tier 1 fully passed — but nothing can be auto_approved without Tier 2
    // actually having run and agreed.
    if (tier2Results === null) return "needs_review";

    // An "optional" source_video_match/source_audio_match item is still
    // evaluated and shown to a reviewer, but never gates the decision —
    // only required items (everything brief-derived, plus any "mandatory"
    // source-match item) can trigger auto_rejected/needs_review here.
    const gating = tier2Results.filter((c) => c.required);

    const highConfidenceFail = gating.some(
      (c) => !c.pass && c.confidence >= HIGH_CONFIDENCE_FAIL_THRESHOLD,
    );
    if (highConfidenceFail) return "auto_rejected";

    const lowConfidence = gating.some((c) => c.confidence < LOW_CONFIDENCE_THRESHOLD);
    if (lowConfidence) return "needs_review";

    return "auto_approved";
  }

  private async getConnection(
    creatorProfileId: string,
    platform: "instagram" | "youtube" | "twitter" | "unknown",
  ): Promise<{ platformHandle: string; platformUserId: string } | null> {
    if (platform === "instagram") {
      return this.prisma.instagramConnection.findUnique({
        where: { creatorProfileId },
        select: { platformHandle: true, platformUserId: true },
      });
    }
    if (platform === "youtube") {
      return this.prisma.youtubeConnection.findUnique({
        where: { creatorProfileId },
        select: { platformHandle: true, platformUserId: true },
      });
    }
    return null;
  }
}
