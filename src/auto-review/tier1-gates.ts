import type { PostAuthor, PostResolution } from "../common/apify.service";
import type { GateResult } from "./auto-review.types";

/** Instagram-only: resolves_and_public and ownership_verified are both
 * derived from the SAME first-party Graph API lookup — the connected
 * account's own media list — instead of HikerAPI's checkPostResolves/
 * getPostAuthor. A match proves both the post exists and who posted it in
 * one first-party call: only reachable when it's genuinely this account's
 * own post, so there's nothing further to distinguish between "resolves"
 * and "is theirs" the way there is for a third-party scrape of an
 * arbitrary public URL. No connection, or no match found within the
 * lookup's page cap, is unresolved rather than a hard fail — the same
 * "let a human decide" philosophy the non-Instagram version already uses. */
export function evaluateInstagramResolvesGate(
  connection: { platformHandle: string; platformUserId: string } | null,
  ownMedia: { kind: "video" | "image"; url: string } | null,
): GateResult {
  if (!connection) {
    return {
      gate: "resolves_and_public",
      status: "unresolved",
      reason: "Creator is not connected via official OAuth for this platform",
    };
  }
  if (ownMedia) {
    return {
      gate: "resolves_and_public",
      status: "pass",
      reason: "Live post found on the connected account's own Instagram media",
    };
  }
  return {
    gate: "resolves_and_public",
    status: "unresolved",
    reason: "Could not find this post on the connected account's own Instagram media",
  };
}

export function evaluateInstagramOwnershipGate(
  connection: { platformHandle: string; platformUserId: string } | null,
  ownMedia: { kind: "video" | "image"; url: string } | null,
): GateResult {
  if (!connection) {
    return {
      gate: "ownership_verified",
      status: "unresolved",
      reason: "Creator is not connected via official OAuth for this platform",
    };
  }
  if (ownMedia) {
    return {
      gate: "ownership_verified",
      status: "pass",
      reason: "Live post found on the connected account's own Instagram media",
    };
  }
  return {
    gate: "ownership_verified",
    status: "unresolved",
    reason: "Could not find this post on the connected account's own Instagram media — needs a human to check",
  };
}

export function evaluateResolvesGate(resolution: PostResolution): GateResult {
  if (resolution.status === "resolved") {
    return {
      gate: "resolves_and_public",
      status: "pass",
      reason: "Live post resolved successfully",
    };
  }
  if (resolution.status === "not_found") {
    return {
      gate: "resolves_and_public",
      status: "fail",
      reason: "Live post link does not resolve (deleted, private, or invalid)",
    };
  }
  return { gate: "resolves_and_public", status: "unresolved", reason: resolution.reason };
}

/** expectedPlatform is a campaign format id like "instagram_reel" /
 * "youtube_shorts" / "twitter_tweet"; detectedPlatform is the coarse family
 * ApifyService.detectPlatform returns from the actual live URL. */
export function evaluatePlatformMatchGate(
  detectedPlatform: string,
  expectedPlatform: string,
): GateResult {
  const expectedFamily = expectedPlatform.startsWith("instagram")
    ? "instagram"
    : expectedPlatform.startsWith("youtube")
      ? "youtube"
      : expectedPlatform.startsWith("twitter")
        ? "twitter"
        : "unknown";

  if (detectedPlatform === "unknown" || expectedFamily === "unknown") {
    return {
      gate: "platform_match",
      status: "unresolved",
      reason: `Could not determine platform for comparison (detected: ${detectedPlatform}, expected: ${expectedPlatform})`,
    };
  }
  if (detectedPlatform === expectedFamily) {
    return {
      gate: "platform_match",
      status: "pass",
      reason: `Live URL platform (${detectedPlatform}) matches campaign requirement (${expectedPlatform})`,
    };
  }
  return {
    gate: "platform_match",
    status: "fail",
    reason: `Live URL platform (${detectedPlatform}) does not match campaign requirement (${expectedPlatform})`,
  };
}

/** A mismatch between the connected account and the scraped author is
 * treated as unresolved, not a hard fail — fraud-style identity checks are
 * explicitly out of scope for this pass, and auto-rejecting on an
 * unverified heuristic (the author-extraction field paths themselves carry
 * some uncertainty — see ApifyService.getPostAuthor) risks false positives
 * on real work. A human decides what a mismatch actually means. */
export function evaluateOwnershipGate(
  connection: { platformHandle: string; platformUserId: string } | null,
  author: PostAuthor | null,
): GateResult {
  if (!connection) {
    return {
      gate: "ownership_verified",
      status: "unresolved",
      reason: "Creator is not connected via official OAuth for this platform",
    };
  }
  if (!author || (!author.handle && !author.platformUserId)) {
    return {
      gate: "ownership_verified",
      status: "unresolved",
      reason: "Could not determine the live post's actual author",
    };
  }
  const idMatch =
    author.platformUserId != null && author.platformUserId === connection.platformUserId;
  const handleMatch =
    author.handle != null && author.handle.toLowerCase() === connection.platformHandle.toLowerCase();
  if (idMatch || handleMatch) {
    return {
      gate: "ownership_verified",
      status: "pass",
      reason: "Live post author matches the creator's connected account",
    };
  }
  return {
    gate: "ownership_verified",
    status: "unresolved",
    reason: "Live post author does not match the creator's connected account — needs a human to check",
  };
}

// Mirrors AutoReviewService's own tier2 thresholds (HIGH_CONFIDENCE_FAIL_THRESHOLD/
// LOW_CONFIDENCE_THRESHOLD) — same two-tier reasoning applied to this Tier 1
// gate: confident enough to act on, or not even confident enough to say
// anything.
const DRAFT_LIVE_MATCH_FAIL_CONFIDENCE = 0.8;
const DRAFT_LIVE_MATCH_LOW_CONFIDENCE = 0.7;

/** Needs Tier 2's vision capability, so it's evaluated from whatever
 * comparison result the orchestrator could actually produce — null covers
 * every reason that could be missing (Drive-linked draft, live media not
 * fetchable, Gemini not configured, platform not yet supported for this
 * specific check — currently Instagram only, see ApifyService.getLivePostMedia). */
export function evaluateDraftLiveMatchGate(
  comparison: { same: boolean; confidence: number; reason: string } | null,
): GateResult {
  if (!comparison) {
    return {
      gate: "draft_live_match",
      status: "unresolved",
      reason: "Could not compare draft and live content (unfetchable media, unsupported platform, or Tier 2 not configured)",
    };
  }
  if (comparison.confidence < DRAFT_LIVE_MATCH_LOW_CONFIDENCE) {
    return {
      gate: "draft_live_match",
      status: "unresolved",
      reason: `Low-confidence comparison (${comparison.confidence}): ${comparison.reason}`,
    };
  }
  if (comparison.same) {
    return { gate: "draft_live_match", status: "pass", reason: comparison.reason };
  }
  // A confident mismatch is a real, actionable signal — most commonly the
  // creator submitted the wrong live URL — so it auto-rejects with a reason
  // clear enough to resubmit against, the same way any other hard-fail gate
  // does. Below the high-confidence bar, it's ambiguous enough to still
  // leave for a human rather than rejecting a real payout automatically.
  if (comparison.confidence >= DRAFT_LIVE_MATCH_FAIL_CONFIDENCE) {
    return {
      gate: "draft_live_match",
      status: "fail",
      reason: `Your live post doesn't match your approved draft — double-check the link and resubmit. (${comparison.reason})`,
    };
  }
  return {
    gate: "draft_live_match",
    status: "unresolved",
    reason: `Content may not match: ${comparison.reason}`,
  };
}
