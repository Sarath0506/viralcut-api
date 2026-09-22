import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { FormatDeliverableStatus, SourceAssetRequirement } from "@prisma/client";

import { ApifyService } from "../common/apify.service";
import type { Env } from "../config/env";
import { InstagramOAuthService } from "../creator-profiles/instagram-oauth.service";
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
  evaluateInstagramOwnershipGate,
  evaluateInstagramResolvesGate,
  evaluateOwnershipGate,
  evaluatePlatformMatchGate,
  evaluateResolvesGate,
} from "./tier1-gates";

const GEMINI_MODEL_VERSION = "gemini-2.5-flash";
const HIGH_CONFIDENCE_FAIL_THRESHOLD = 0.8;
const LOW_CONFIDENCE_THRESHOLD = 0.7;

// catchUpMissedAutoReviews retries a stuck needs_review roughly once per
// 5-minute sweep — 12 attempts is about an hour of retrying before it gives
// up and leaves it for a human. Long enough for any real transient hiccup
// (a Gemini blip, a momentary R2/Graph API failure) to clear on its own;
// short enough that a genuinely broken submission doesn't run forever.
// Exported so the brand-facing API can tell a client "attempt N of this many"
// without a second, driftable copy of the same number.
export const MAX_STUCK_RETRIES = 12;

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
    private readonly instagramOAuth: InstagramOAuthService,
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

  /** submitDraft/submitLiveProof trigger the pipeline once, fire-and-forget,
   * at the exact moment of submission — if AUTO_REVIEW_ENABLED was off at
   * that instant (or the process crashed mid-run), that submission is never
   * retried; nothing else ever revisits it. Confirmed live: two real
   * submissions made while the flag was off got permanently skipped, with
   * no trace beyond a debug log line, until manually re-triggered.
   *
   * This sweep is the backfill, covering five distinct gaps:
   *  1. Zero AutoReviewResult rows at all — never evaluated once (the flag
   *     was off, or the process crashed mid-run).
   *  2. Exactly one result, decision needs_review, tier2Results null, and
   *     every Tier 1 gate actually resolved (not "unresolved") — this
   *     specific shape means getOrCreateChecklist's Gemini call came back
   *     empty that one time (confirmed live: a transient API hiccup, not a
   *     content problem — the identical brief succeeded on immediate
   *     retry) rather than a genuine "can't check this" case like an
   *     un-fetchable Drive link (which shows up as an unresolved Tier 1
   *     gate instead, and retrying that wouldn't help).
   *  3. Same shape, but the ONLY unresolved Tier 1 gate is draft_live_match
   *     with ownership_verified already passed (non-Instagram only — see
   *     #4) — that gate depends on a live CDN fetch plus a Gemini call, so
   *     it fails the same transient way checklist derivation does, not a
   *     structural limit.
   *  4. Instagram only: any combination of resolves_and_public,
   *     ownership_verified, and draft_live_match unresolved together — all
   *     three come from the same first-party Graph API lookup with no
   *     HikerAPI involved, so a shared failure across them is far more
   *     likely one transient Graph API hiccup than several independent
   *     structural limits. Confirmed live: HikerAPI itself went down (402
   *     Payment Required) and took out ownership_verified and
   *     draft_live_match together for one real submission — outside what
   *     gap #3's single-gate rule would ever retry, even after the
   *     HikerAPI dependency was removed.
   *  5. Enforcement-only: decision is already auto_approved/auto_rejected
   *     (not needs_review — gaps 1-4 don't apply) and the deliverable is
   *     still sitting in a reviewable status, meaning the decision was
   *     computed while AUTO_REVIEW_ENFORCE_ENABLED was off and never
   *     applied. Confirmed live: enabling enforcement doesn't retroactively
   *     touch anything decided beforehand — every other gap here only ever
   *     looks for needs_review, so a confident decision reads as "nothing
   *     left to do" everywhere else. Applies the already-computed outcome
   *     directly instead of re-evaluating, since the point is enforcing
   *     the answer already reached, not risking a second, possibly
   *     different verdict for something already decided.
   * A resubmission is a different case in all five — submitDraft/submitLiveProof
   * re-trigger the pipeline directly for that. All five gaps are merged into one
   * first-submitted-first-served queue, oldest first, same as a human
   * reviewer's queue would be. Bounded per run so a large backlog can't burn
   * through the Gemini/Apify rate limit in one pass — the remainder just
   * waits for the next cycle. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async catchUpMissedAutoReviews(): Promise<void> {
    if (!this.enabled) return;
    try {
      const maxPerRun = 10;
      const reviewableStatuses = [
        FormatDeliverableStatus.under_review,
        FormatDeliverableStatus.live_submitted,
        FormatDeliverableStatus.proof_under_review,
      ];

      const [draftBacklog, proofBacklog, stuckCandidates] = await Promise.all([
        this.prisma.formatDeliverable.findMany({
          where: { status: FormatDeliverableStatus.under_review, autoReviewResults: { none: {} } },
          orderBy: { draftSubmittedAt: "asc" },
          take: maxPerRun,
          select: { id: true, draftSubmittedAt: true },
        }),
        this.prisma.formatDeliverable.findMany({
          where: {
            status: { in: [FormatDeliverableStatus.live_submitted, FormatDeliverableStatus.proof_under_review] },
            autoReviewResults: { none: {} },
          },
          orderBy: { liveSubmittedAt: "asc" },
          take: maxPerRun,
          select: { id: true, liveSubmittedAt: true },
        }),
        this.prisma.formatDeliverable.findMany({
          where: { status: { in: reviewableStatuses }, autoReviewResults: { some: {} } },
          include: {
            autoReviewResults: { orderBy: { createdAt: "desc" }, take: 1 },
            _count: { select: { autoReviewResults: true } },
          },
          take: 50, // bounds the scan itself, not the retry count after filtering
        }),
      ]);

      const stuckQueue = stuckCandidates
        .filter((d) => {
          const latest = d.autoReviewResults[0];
          if (!latest || latest.decision !== "needs_review") return false;
          // Confirmed live: without a cap, two stuck deliverables (one of
          // them leftover test data) were retried 900+ times each over 17
          // days — 94% of every auto-review attempt this pipeline has ever
          // made — while burning real Gemini/Graph API quota every 5
          // minutes for something that was never going to resolve. Every
          // retry path below assumes a transient hiccup; past this many
          // attempts (~an hour of retries) that assumption has been
          // disproven, so it stops and waits for a human instead of
          // retrying forever.
          if (d._count.autoReviewResults >= MAX_STUCK_RETRIES) {
            this.logger.warn(
              `Giving up on retrying ${d.id} after ${d._count.autoReviewResults} attempts — needs a human, not another retry`,
            );
            return false;
          }
          const tier1 = latest.tier1Results as GateResult[] | null;
          if (!Array.isArray(tier1)) return false;
          const unresolved = tier1.filter((g) => g.status === "unresolved");
          // Every Tier 1 gate resolved, but tier2Results is still null —
          // means getOrCreateChecklist's Gemini call itself came back empty
          // that one time (confirmed live: a transient API hiccup, not a
          // content problem). tier2Results being non-null here would mean
          // Tier 2 actually ran and there's nothing left to retry.
          if (unresolved.length === 0) return latest.tier2Results === null;
          // Everything past this point is about an unresolved Tier 1 gate,
          // not tier2Results — deliberately NOT gated on tier2Results being
          // null anymore. draft_live_match is its own independent Gemini
          // call (compareDraftToLive, not evaluateCompliance): a real
          // compliance pass can complete in the very same run that leaves
          // draft_live_match unresolved, and that's exactly what happened
          // live once Gemini started working again — tier2Results came back
          // fully populated while draft_live_match still needed a retry of
          // its own, and the old tier2Results-must-be-null check silently
          // excluded it from ever being retried again.
          //
          // Instagram exception: resolves_and_public, ownership_verified,
          // and draft_live_match are ALL sourced from the same first-party
          // Graph API lookup now (no HikerAPI involved for any of the
          // three) — any combination of just these going unresolved is far
          // more likely a transient Graph API hiccup than a structural
          // limit. Confirmed live: HikerAPI itself went down (402 Payment
          // Required — an account-balance issue) and took out
          // ownership_verified AND draft_live_match together for one real
          // submission, permanently excluding it from the old
          // draft_live_match-alone-only rule below even after the HikerAPI
          // dependency was removed entirely.
          const instagramOnlyGates = new Set(["resolves_and_public", "ownership_verified", "draft_live_match"]);
          if (
            this.apify.detectPlatform(d.livePostUrl ?? "") === "instagram" &&
            unresolved.every((g) => instagramOnlyGates.has(g.gate))
          ) {
            return true;
          }
          // Non-Instagram: draft_live_match depends on a live CDN fetch
          // plus a Gemini call — the same kind of transient-hiccup surface
          // as checklist derivation, not a structural limit — once
          // ownership_verified has already passed (proof the OAuth
          // connection itself is fine). Everything else on this platform
          // still goes through Apify, so a wider exception isn't safe here.
          if (unresolved.length === 1 && unresolved[0].gate === "draft_live_match") {
            return tier1.find((g) => g.gate === "ownership_verified")?.status === "pass";
          }
          // Draft stage's only Tier 1 gate is format_match — the same kind
          // of "fetchMedia on a real, fetchable URL failed" transient
          // surface as draft_live_match above, not a structural limit.
          // Confirmed live: five real drafts failed this gate once each
          // (misreported as "likely a Drive link"), and every one of their
          // draft URLs fetches fine on demand weeks later — nothing was
          // ever wrong with the file, they just never got a second try
          // because this stage had no retry path at all until now.
          if (unresolved.length === 1 && unresolved[0].gate === "format_match") {
            return true;
          }
          return false;
        })
        .map((d) => ({
          id: d.id,
          stage: (d.status === FormatDeliverableStatus.under_review ? "draft" : "proof") as "draft" | "proof",
          submittedAt: d.status === FormatDeliverableStatus.under_review ? d.draftSubmittedAt! : d.liveSubmittedAt!,
          outcome: undefined as AutoReviewOutcome | undefined,
        }));

      // Gap #5, enforcement-only: a confident auto_approved/auto_rejected
      // decision that was computed while AUTO_REVIEW_ENFORCE_ENABLED was
      // off (shadow mode) and never got applied — the deliverable is still
      // sitting in a reviewable status with a real decision already on
      // file. Confirmed live: turning enforcement on doesn't retroactively
      // touch anything decided before that moment, since this sweep's
      // other gaps only ever look for needs_review — a decided outcome
      // reads as "nothing left to do" everywhere else. Applies the
      // already-computed outcome directly (applyDraftDecision/
      // applyProofDecision, which safely no-op if a human already acted
      // since) rather than re-evaluating — the point is to enforce the
      // answer already reached, not risk a second, possibly different
      // verdict for something already decided.
      const unenforcedDecidedQueue = this.enforceEnabled
        ? stuckCandidates
            .filter((d) => {
              const latest = d.autoReviewResults[0];
              return latest?.decision === "auto_approved" || latest?.decision === "auto_rejected";
            })
            .map((d) => {
              const latest = d.autoReviewResults[0];
              return {
                id: d.id,
                stage: (d.status === FormatDeliverableStatus.under_review ? "draft" : "proof") as "draft" | "proof",
                submittedAt: d.status === FormatDeliverableStatus.under_review ? d.draftSubmittedAt! : d.liveSubmittedAt!,
                outcome: {
                  decision: latest.decision,
                  tier1Results: latest.tier1Results as GateResult[],
                  tier2Results: latest.tier2Results as CriterionResult[] | null,
                  modelVersion: latest.modelVersion,
                } as AutoReviewOutcome,
              };
            })
        : [];

      // Merge all sources into one first-submitted-first-served order,
      // capped at maxPerRun total so one sweep can't overrun the rate limit.
      const queue = [
        ...draftBacklog.map((d) => ({ id: d.id, stage: "draft" as const, submittedAt: d.draftSubmittedAt!, outcome: undefined as AutoReviewOutcome | undefined })),
        ...proofBacklog.map((d) => ({ id: d.id, stage: "proof" as const, submittedAt: d.liveSubmittedAt!, outcome: undefined as AutoReviewOutcome | undefined })),
        ...stuckQueue,
        ...unenforcedDecidedQueue,
      ]
        .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())
        .slice(0, maxPerRun);

      if (queue.length === 0) return;

      this.logger.log(`catchUpMissedAutoReviews: processing ${queue.length} deliverable(s)`);
      for (const item of queue) {
        if (item.outcome) {
          if (item.stage === "draft") {
            await this.applyDraftDecision(item.id, item.outcome);
          } else {
            await this.applyProofDecision(item.id, item.outcome);
          }
        } else if (item.stage === "draft") {
          await this.runDraftPipeline(item.id);
        } else {
          await this.runProofPipeline(item.id);
        }
        // Same courtesy pause the metrics sweep uses — this is an unattended
        // background catch-up, not a human waiting on a response.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (err) {
      this.logger.error(`catchUpMissedAutoReviews failed: ${err}`);
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
        sendWhatsapp: true,
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
      sendWhatsapp: true,
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
        sendWhatsapp: true,
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
      sendWhatsapp: true,
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
    const isInstagram = platform === "instagram";
    // Prefer a brand/admin-uploaded copy of the source video — set when
    // draftDriveUrl is a Drive link the pipeline can't fetch itself.
    const fetchableDraftUrl = deliverable.adminUploadedDraftUrl ?? deliverable.draftDriveUrl;

    // Instagram no longer touches Apify/HikerAPI at all for these checks —
    // confirmed live that HikerAPI can go down entirely (402 Payment
    // Required, an account-balance issue, not a code bug) and silently
    // stall every Instagram proof stuck behind it. One Graph API lookup
    // against the connected account's own media list — first-party, no
    // third party to go down — answers resolves_and_public, ownership, and
    // (below) draft_live_match's media source all at once: reachable only
    // when it's genuinely this account's own post. YouTube/Twitter still
    // use Apify — there's no OAuth-backed alternative for those yet, and
    // removing it would break their proof review entirely with nothing to
    // replace it (a tradeoff already flagged and accepted separately).
    const [resolution, author, connection, draftMedia, instagramOwnMedia] = await Promise.all([
      isInstagram ? Promise.resolve(null) : this.apify.checkPostResolves(livePostUrl),
      isInstagram ? Promise.resolve(null) : this.apify.getPostAuthor(livePostUrl),
      this.getConnection(creatorProfileId, platform),
      fetchableDraftUrl ? fetchMedia(fetchableDraftUrl) : Promise.resolve(null),
      isInstagram ? this.instagramOAuth.getOwnLivePostMedia(creatorProfileId, livePostUrl) : Promise.resolve(null),
    ]);
    const resolvesGate = isInstagram
      ? evaluateInstagramResolvesGate(connection, instagramOwnMedia)
      : evaluateResolvesGate(resolution!);
    const ownershipGate = isInstagram
      ? evaluateInstagramOwnershipGate(connection, instagramOwnMedia)
      : evaluateOwnershipGate(connection, author);

    let liveComparison: { same: boolean; confidence: number; reason: string } | null = null;
    if (!draftMedia && fetchableDraftUrl) {
      this.logger.warn(`draft_live_match unresolved for ${deliverableId}: fetchMedia on the draft (${fetchableDraftUrl}) failed`);
    }
    if (draftMedia) {
      // Reuses the same Instagram lookup made above — no second Graph API
      // call. Never scrapes a live post on trust alone for any platform:
      // draft-vs-live stays unresolved whenever ownership isn't
      // independently verified first.
      const liveMedia = ownershipGate.status === "pass" ? instagramOwnMedia : null;
      if (liveMedia) {
        const liveMediaFetched = await fetchMedia(liveMedia.url);
        if (liveMediaFetched) {
          liveComparison = await this.gemini.compareDraftToLive({
            draftMediaBuffer: draftMedia.buffer,
            draftMimeType: draftMedia.mimeType,
            liveMediaBuffer: liveMediaFetched.buffer,
            liveMediaKind: liveMedia.kind,
          });
          if (!liveComparison) {
            this.logger.warn(`draft_live_match unresolved for ${deliverableId}: compareDraftToLive returned null`);
          }
        } else {
          this.logger.warn(
            `draft_live_match unresolved for ${deliverableId}: got a live media URL (${liveMedia.kind}) but fetchMedia on it failed`,
          );
        }
      } else if (isInstagram && ownershipGate.status === "pass") {
        this.logger.warn(
          `draft_live_match unresolved for ${deliverableId}: getOwnLivePostMedia found nothing for ${livePostUrl}`,
        );
      }
    }

    const tier1Results: GateResult[] = [
      resolvesGate,
      evaluatePlatformMatchGate(platform, deliverable.platform),
      ownershipGate,
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
