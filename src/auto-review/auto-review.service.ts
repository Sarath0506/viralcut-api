import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ApifyService } from "../common/apify.service";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { AutoReviewOutcome, CriterionResult, GateResult } from "./auto-review.types";
import { ChecklistService } from "./checklist.service";
import { checkFormatGate } from "./format-gate";
import { GeminiService } from "./gemini.service";
import { fetchVideoBuffer } from "./media-fetch";
import {
  evaluateDraftLiveMatchGate,
  evaluateOwnershipGate,
  evaluatePlatformMatchGate,
  evaluateResolvesGate,
} from "./tier1-gates";

const GEMINI_MODEL_VERSION = "gemini-2.5-flash";
const HIGH_CONFIDENCE_FAIL_THRESHOLD = 0.8;
const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Automated pre-screening for both the draft/work-upload stage and the
 * live-proof stage, run in shadow mode alongside the existing human review
 * flows for each — it only ever produces a logged AutoReviewResult row.
 * Never touches a deliverable's real status, never sets paidAmountPaise,
 * never calls anything in payouts.service.ts. Gated end-to-end behind
 * AUTO_REVIEW_ENABLED — with that off (the default), nothing here runs and
 * no external API is ever called. See the plan doc for the full design and
 * the gaps this deliberately doesn't attempt to solve. */
@Injectable()
export class AutoReviewService {
  private readonly logger = new Logger(AutoReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apify: ApifyService,
    private readonly gemini: GeminiService,
    private readonly checklist: ChecklistService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get enabled(): boolean {
    return this.config.get("AUTO_REVIEW_ENABLED", { infer: true });
  }

  /** Entry point from submitLiveProof — fire-and-forget, never awaited. */
  async runProofPipeline(deliverableId: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const outcome = await this.evaluateProof(deliverableId);
      if (outcome) await this.persist(deliverableId, "proof", outcome);
    } catch (err) {
      this.logger.error(`Proof auto-review failed for deliverable ${deliverableId}: ${err}`);
    }
  }

  /** Entry point from submitDraft — fire-and-forget, never awaited. */
  async runDraftPipeline(deliverableId: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const outcome = await this.evaluateDraft(deliverableId);
      if (outcome) await this.persist(deliverableId, "draft", outcome);
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

  private async evaluateProof(deliverableId: string): Promise<AutoReviewOutcome | null> {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: {
        participation: {
          select: {
            creatorProfileId: true,
            campaign: { select: { id: true, brief: true, doRules: true, avoidRules: true } },
          },
        },
      },
    });
    if (!deliverable || !deliverable.livePostUrl) {
      this.logger.warn(`Proof auto-review skipped — deliverable ${deliverableId} not found or has no live URL`);
      return null;
    }

    const livePostUrl = deliverable.livePostUrl;
    const creatorProfileId = deliverable.participation.creatorProfileId;
    const platform = this.apify.detectPlatform(livePostUrl);

    const [resolution, author, connection, draftBuffer] = await Promise.all([
      this.apify.checkPostResolves(livePostUrl),
      this.apify.getPostAuthor(livePostUrl),
      this.getConnection(creatorProfileId, platform),
      deliverable.draftDriveUrl ? fetchVideoBuffer(deliverable.draftDriveUrl) : Promise.resolve(null),
    ]);

    let liveComparison: { same: boolean; confidence: number; reason: string } | null = null;
    if (draftBuffer) {
      const liveMedia = await this.apify.getLivePostMedia(livePostUrl);
      if (liveMedia) {
        const liveBuffer = await fetchVideoBuffer(liveMedia.url);
        if (liveBuffer) {
          liveComparison = await this.gemini.compareDraftToLive({
            draftVideoBuffer: draftBuffer,
            liveMediaBuffer: liveBuffer,
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

    const tier2Results = draftBuffer
      ? await this.runCompliance(deliverable.participation.campaign, draftBuffer, null)
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
          select: { campaign: { select: { id: true, brief: true, doRules: true, avoidRules: true } } },
        },
      },
    });
    if (!deliverable || !deliverable.draftDriveUrl) {
      this.logger.warn(`Draft auto-review skipped — deliverable ${deliverableId} not found or has no draft`);
      return null;
    }

    const draftBuffer = await fetchVideoBuffer(deliverable.draftDriveUrl);
    if (!draftBuffer) {
      // Drive-linked drafts aren't server-fetchable — see the plan doc.
      // Not a failure, just nothing this pipeline can check.
      const tier1Results: GateResult[] = [
        {
          gate: "format_match",
          status: "unresolved",
          reason: "Draft is not an app-uploaded file (likely a Drive link) — can't fetch it to check",
        },
      ];
      return { decision: "needs_review", tier1Results, tier2Results: null, modelVersion: null };
    }

    const formatResult = await checkFormatGate(draftBuffer, deliverable.platform);
    const tier1Results: GateResult[] = [formatResult];

    const tier2Results = await this.runCompliance(deliverable.participation.campaign, draftBuffer, null);

    return {
      decision: this.decide(tier1Results, tier2Results),
      tier1Results,
      tier2Results,
      modelVersion: tier2Results ? GEMINI_MODEL_VERSION : null,
    };
  }

  private async runCompliance(
    campaign: { id: string; brief: string; doRules: string | null; avoidRules: string | null },
    videoBuffer: Buffer,
    caption: string | null,
  ): Promise<CriterionResult[] | null> {
    const checklist = await this.checklist.getOrCreateChecklist(campaign.id);
    if (!checklist) return null;
    return this.gemini.evaluateCompliance({ videoBuffer, caption, checklist });
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

    const highConfidenceFail = tier2Results.some(
      (c) => !c.pass && c.confidence >= HIGH_CONFIDENCE_FAIL_THRESHOLD,
    );
    if (highConfidenceFail) return "auto_rejected";

    const lowConfidence = tier2Results.some((c) => c.confidence < LOW_CONFIDENCE_THRESHOLD);
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
