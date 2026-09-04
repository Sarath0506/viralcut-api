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

/** Ships with Tier 2 (needs frame extraction + a vision model to do a real
 * comparison) — deliberately stubbed as unresolved for now rather than
 * built as a fake "deterministic" check, despite being listed under Tier 1
 * in the original spec. See the plan doc for why. */
export function stubDraftLiveMatchGate(): GateResult {
  return {
    gate: "draft_live_match",
    status: "unresolved",
    reason: "Draft-vs-live similarity check not yet implemented — ships with Tier 2",
  };
}
