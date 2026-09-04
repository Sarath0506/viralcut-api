import type { PostAuthor, PostResolution } from "../common/apify.service";
import type { GateResult } from "./auto-review.types";

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
  if (comparison.confidence < 0.7) {
    return {
      gate: "draft_live_match",
      status: "unresolved",
      reason: `Low-confidence comparison (${comparison.confidence}): ${comparison.reason}`,
    };
  }
  if (comparison.same) {
    return { gate: "draft_live_match", status: "pass", reason: comparison.reason };
  }
  // A confident mismatch still isn't a hard fail — per the spec, this needs
  // a human to see what actually happened, not an automatic reject.
  return {
    gate: "draft_live_match",
    status: "unresolved",
    reason: `Content may not match: ${comparison.reason}`,
  };
}
