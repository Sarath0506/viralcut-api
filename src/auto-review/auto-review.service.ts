import { Injectable, Logger } from "@nestjs/common";

import { ApifyService } from "../common/apify.service";
import { PrismaService } from "../prisma/prisma.service";
import type { AutoReviewOutcome, GateResult } from "./auto-review.types";
import {
  evaluateOwnershipGate,
  evaluatePlatformMatchGate,
  evaluateResolvesGate,
  stubDraftLiveMatchGate,
} from "./tier1-gates";

/** Automated pre-screening for a submitted live proof, run in shadow mode
 * alongside the existing human approveProof()/rejectProof() flow — it only
 * ever produces a logged AutoReviewResult row. It never touches the
 * deliverable's real status, never sets paidAmountPaise, and never calls
 * anything in payouts.service.ts. See the plan doc (feat/automated-proof-
 * review branch) for the full design and the gaps this pass deliberately
 * doesn't attempt to solve (Drive-linked drafts, true video-to-video
 * comparison for the draft-vs-live gate). */
@Injectable()
export class AutoReviewService {
  private readonly logger = new Logger(AutoReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apify: ApifyService,
  ) {}

  /** Entry point — always called fire-and-forget from submitLiveProof, never
   * awaited by the request/response cycle. Swallows every error itself so a
   * pipeline failure can never surface to the caller or crash anything;
   * worst case, no AutoReviewResult row gets written for this run. */
  async runPipeline(deliverableId: string): Promise<void> {
    try {
      const outcome = await this.evaluate(deliverableId);
      if (!outcome) return;
      await this.prisma.autoReviewResult.create({
        data: {
          deliverableId,
          decision: outcome.decision,
          tier1Results: outcome.tier1Results,
          tier2Results: outcome.tier2Results ?? undefined,
          modelVersion: outcome.modelVersion,
        },
      });
    } catch (err) {
      this.logger.error(`Auto-review pipeline failed for deliverable ${deliverableId}: ${err}`);
    }
  }

  private async evaluate(deliverableId: string): Promise<AutoReviewOutcome | null> {
    const deliverable = await this.prisma.formatDeliverable.findUnique({
      where: { id: deliverableId },
      include: {
        participation: { select: { creatorProfileId: true } },
      },
    });

    if (!deliverable || !deliverable.livePostUrl) {
      this.logger.warn(`Auto-review skipped — deliverable ${deliverableId} not found or has no live URL`);
      return null;
    }

    const livePostUrl = deliverable.livePostUrl;
    const creatorProfileId = deliverable.participation.creatorProfileId;

    const [resolution, author, connection] = await Promise.all([
      this.apify.checkPostResolves(livePostUrl),
      this.apify.getPostAuthor(livePostUrl),
      this.getConnection(creatorProfileId, this.apify.detectPlatform(livePostUrl)),
    ]);

    const tier1Results: GateResult[] = [
      evaluateResolvesGate(resolution),
      evaluatePlatformMatchGate(this.apify.detectPlatform(livePostUrl), deliverable.platform),
      evaluateOwnershipGate(connection, author),
      stubDraftLiveMatchGate(),
    ];

    return {
      decision: this.decide(tier1Results),
      tier1Results,
      // Tier 2 hasn't run yet in this build — a clean Tier 1 pass still
      // can't reach auto_approved until it does (see decide()).
      tier2Results: null,
      modelVersion: null,
    };
  }

  private decide(tier1Results: GateResult[]): AutoReviewOutcome["decision"] {
    // Only the two genuinely deterministic gates (resolves, platform match)
    // can trigger an auto-reject — ownership and draft-vs-live are
    // "unresolved, never failed" by design, per the spec.
    const hardFail = tier1Results.some(
      (r) => r.status === "fail" && (r.gate === "resolves_and_public" || r.gate === "platform_match"),
    );
    if (hardFail) return "auto_rejected";

    // Anything unresolved (including the Tier 2 stub, always unresolved
    // until the next diff) means we can't confidently auto-approve yet.
    return "needs_review";
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
