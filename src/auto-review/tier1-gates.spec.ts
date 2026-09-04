import { describe, expect, it } from "vitest";

import {
  evaluateDraftLiveMatchGate,
  evaluateOwnershipGate,
  evaluatePlatformMatchGate,
  evaluateResolvesGate,
} from "./tier1-gates";

describe("evaluateResolvesGate", () => {
  it("passes when the post resolved", () => {
    expect(evaluateResolvesGate({ status: "resolved" }).status).toBe("pass");
  });

  it("hard-fails when the post is confirmed not found", () => {
    expect(evaluateResolvesGate({ status: "not_found" }).status).toBe("fail");
  });

  it("is unresolved (not failed) when the scrape itself couldn't confirm either way", () => {
    const result = evaluateResolvesGate({ status: "unresolved", reason: "network error" });
    expect(result.status).toBe("unresolved");
    expect(result.reason).toBe("network error");
  });
});

describe("evaluatePlatformMatchGate", () => {
  it("passes when the detected platform matches the campaign format", () => {
    expect(evaluatePlatformMatchGate("instagram", "instagram_reel").status).toBe("pass");
  });

  it("fails when the detected platform doesn't match", () => {
    expect(evaluatePlatformMatchGate("youtube", "instagram_reel").status).toBe("fail");
  });

  it("is unresolved when either platform can't be determined", () => {
    expect(evaluatePlatformMatchGate("unknown", "instagram_reel").status).toBe("unresolved");
  });
});

describe("evaluateOwnershipGate", () => {
  it("is unresolved when the creator has no official OAuth connection", () => {
    const result = evaluateOwnershipGate(null, { handle: "someone", platformUserId: "123" });
    expect(result.status).toBe("unresolved");
  });

  it("is unresolved when the live post's author can't be determined", () => {
    const connection = { platformHandle: "creator", platformUserId: "1" };
    expect(evaluateOwnershipGate(connection, null).status).toBe("unresolved");
  });

  it("passes when the connected platformUserId matches the scraped author", () => {
    const connection = { platformHandle: "creator", platformUserId: "1" };
    const result = evaluateOwnershipGate(connection, { handle: "different_handle", platformUserId: "1" });
    expect(result.status).toBe("pass");
  });

  it("passes when the connected handle matches case-insensitively", () => {
    const connection = { platformHandle: "Creator", platformUserId: "1" };
    const result = evaluateOwnershipGate(connection, { handle: "creator", platformUserId: "999" });
    expect(result.status).toBe("pass");
  });

  it("is unresolved (not failed) when connected but the author doesn't match — never auto-rejects on an identity mismatch", () => {
    const connection = { platformHandle: "creator", platformUserId: "1" };
    const result = evaluateOwnershipGate(connection, { handle: "someone_else", platformUserId: "999" });
    expect(result.status).toBe("unresolved");
  });
});

describe("evaluateDraftLiveMatchGate", () => {
  it("is unresolved when no comparison could be made", () => {
    expect(evaluateDraftLiveMatchGate(null).status).toBe("unresolved");
  });

  it("is unresolved when the comparison confidence is too low", () => {
    const result = evaluateDraftLiveMatchGate({ same: true, confidence: 0.5, reason: "not sure" });
    expect(result.status).toBe("unresolved");
  });

  it("passes on a confident match", () => {
    const result = evaluateDraftLiveMatchGate({ same: true, confidence: 0.95, reason: "same clip" });
    expect(result.status).toBe("pass");
  });

  it("is unresolved (not failed) on a confident mismatch — needs a human to look", () => {
    const result = evaluateDraftLiveMatchGate({ same: false, confidence: 0.95, reason: "different clip" });
    expect(result.status).toBe("unresolved");
  });
});
